//! Synthesis elaboration: walks the veryl-parser syntax tree, flattens the
//! module hierarchy and lowers behaviour straight into gates.
//!
//! Deliberately separate from veryl-sim's elaborator: synthesis needs a
//! name-based statement IR that is *symbolically executed* (if/case become
//! muxes, loops are unrolled, functions are inlined), not a simulator IR.
//!
//! Every declared signal gets placeholder wires up front, so items can be
//! processed in any order; a driver is recorded as an alias
//! (placeholder bit -> driving bit) and resolved later in `netlist::optimize`.

use crate::expr::*;
use crate::netlist::*;
use crate::netlist::{Bit, Dir, Port};
use crate::value::*;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use veryl_parser::veryl_grammar_trait::*;
use veryl_parser::veryl_walker::VerylWalker;
use veryl_parser::TokenCollector;

pub type R<T> = Result<T, String>;

/// Collect the source tokens (as text) of any syntax node via the Veryl walker.
pub fn toks<F: FnOnce(&mut TokenCollector)>(f: F) -> Vec<String> {
    let mut c = TokenCollector::new(false);
    f(&mut c);
    c.tokens.iter().map(|t| t.to_string()).collect()
}

// ---------------- library: modules + packages ----------------

#[derive(Default)]
pub struct PkgDef {
    pub enums: HashMap<String, u32>,
    /// struct name -> fields (name, width), declaration order
    pub structs: HashMap<String, Vec<(String, u32)>>,
}

pub struct Lib<'a> {
    pub modules: HashMap<String, (&'a ModuleDeclaration, bool)>,
    pub ifaces: HashMap<String, &'a InterfaceDeclaration>,
    pub order: Vec<(String, bool)>,
    pub pkgs: HashMap<String, PkgDef>,
    /// "Pkg::Enum::Member" and "Pkg::CONST" -> value
    pub consts: HashMap<String, Val>,
}

impl<'a> Lib<'a> {
    pub fn new() -> Self {
        Lib { modules: HashMap::new(), ifaces: HashMap::new(), order: vec![], pkgs: HashMap::new(), consts: HashMap::new() }
    }

    pub fn add(&mut self, v: &'a Veryl) {
        for l in &v.veryl_list { self.collect(&l.description_group); }
    }

    fn collect(&mut self, g: &'a DescriptionGroup) {
        let is_test = g.description_group_list.iter().any(|a| {
            toks(|c| c.attribute(&a.attribute)).iter().skip(1).any(|x| x == "test")
        });
        match &*g.description_group_group {
            DescriptionGroupGroup::DescriptionItem(x) => {
                if let DescriptionItem::DescriptionItemOptPublicDescriptionItem(y) = &*x.description_item {
                    match &*y.public_description_item {
                        PublicDescriptionItem::ModuleDeclaration(z) => {
                            let m = &z.module_declaration;
                            let name = m.identifier.identifier_token.to_string();
                            self.order.push((name.clone(), is_test));
                            self.modules.insert(name, (m, is_test));
                        }
                        PublicDescriptionItem::PackageDeclaration(z) => self.package(&z.package_declaration),
                        PublicDescriptionItem::InterfaceDeclaration(z) => {
                            let d = &z.interface_declaration;
                            self.ifaces.insert(d.identifier.identifier_token.to_string(), d);
                        }
                        _ => {}
                    }
                }
            }
            DescriptionGroupGroup::LBraceDescriptionGroupGroupListRBrace(x) => {
                for y in &x.description_group_group_list { self.collect(&y.description_group); }
            }
        }
    }

    fn package(&mut self, d: &PackageDeclaration) {
        let pname = d.identifier.identifier_token.to_string();
        let mut items: Vec<&PackageItem> = vec![];
        fn group<'x>(g: &'x PackageGroup, out: &mut Vec<&'x PackageItem>) {
            match &*g.package_group_group {
                PackageGroupGroup::PackageItem(x) => out.push(&x.package_item),
                PackageGroupGroup::LBracePackageGroupGroupListRBrace(x) => {
                    for y in &x.package_group_group_list { group(&y.package_group, out); }
                }
            }
        }
        for l in &d.package_declaration_list { group(&l.package_group, &mut items); }
        self.pkgs.insert(pname.clone(), PkgDef::default());
        let sc = Scope::default();
        for it in items {
            match it {
                PackageItem::ConstDeclaration(x) => {
                    let c = &x.const_declaration;
                    if let Ok(v) = self.const_of(&sc, &toks(|k| k.expression(&c.expression))) {
                        self.consts.insert(format!("{}::{}", pname, c.identifier.identifier_token), v);
                    }
                }
                PackageItem::EnumDeclaration(x) => {
                    let e = &x.enum_declaration;
                    let ename = e.identifier.identifier_token.to_string();
                    let mut members: Vec<(String, Option<Vec<String>>)> = vec![];
                    fn eg(g: &EnumGroup, out: &mut Vec<(String, Option<Vec<String>>)>) {
                        match &*g.enum_group_group {
                            EnumGroupGroup::EnumItem(x) => {
                                let ei = &x.enum_item;
                                out.push((ei.identifier.identifier_token.to_string(),
                                    ei.enum_item_opt.as_ref().map(|o| toks(|c| c.expression(&o.expression)))));
                            }
                            EnumGroupGroup::LBraceEnumListRBrace(x) => {
                                eg(&x.enum_list.enum_group, out);
                                for y in &x.enum_list.enum_list_list { eg(&y.enum_group, out); }
                            }
                        }
                    }
                    eg(&e.enum_list.enum_group, &mut members);
                    for y in &e.enum_list.enum_list_list { eg(&y.enum_group, &mut members); }
                    let w = match &e.enum_declaration_opt {
                        Some(o) => self.parse_type(&sc, &toks(|c| c.scalar_type(&o.scalar_type))).map(|t| t.w).unwrap_or(32),
                        None => bits_for(members.len()).max(1) as u32,
                    };
                    let mut next = 0u128;
                    for (m, ex) in members {
                        let v = match ex { Some(t) => self.const_of(&sc, &t).map(|v| v.v.lo()).unwrap_or(next), None => next };
                        next = v + 1;
                        self.consts.insert(format!("{}::{}::{}", pname, ename, m), Val::new(w, v));
                    }
                    self.pkgs.get_mut(&pname).unwrap().enums.insert(ename, w);
                }
                PackageItem::StructUnionDeclaration(x) => {
                    let s = &x.struct_union_declaration;
                    if !toks(|c| c.struct_union(&s.struct_union)).join("").contains("struct") { continue; }
                    let mut fields = vec![];
                    fn sg(lib: &Lib, g: &StructUnionGroup, out: &mut Vec<(String, u32)>) {
                        match &*g.struct_union_group_group {
                            StructUnionGroupGroup::StructUnionItem(x) => {
                                let si = &x.struct_union_item;
                                let t = toks(|c| c.scalar_type(&si.scalar_type));
                                if let Ok(ty) = lib.parse_type(&Scope::default(), &t) {
                                    out.push((si.identifier.identifier_token.to_string(), ty.w));
                                }
                            }
                            StructUnionGroupGroup::LBraceStructUnionListRBrace(x) => {
                                sg(lib, &x.struct_union_list.struct_union_group, out);
                                for y in &x.struct_union_list.struct_union_list_list { sg(lib, &y.struct_union_group, out); }
                            }
                        }
                    }
                    sg(self, &s.struct_union_list.struct_union_group, &mut fields);
                    for y in &s.struct_union_list.struct_union_list_list { sg(self, &y.struct_union_group, &mut fields); }
                    self.pkgs.get_mut(&pname).unwrap().structs.insert(s.identifier.identifier_token.to_string(), fields);
                }
                _ => {}
            }
        }
    }

    /// module / interface parameters: overrides, else the defaults
    pub fn params(&self, sc: &mut Scope, wp: &WithParameter, ov: &HashMap<String, Val>) -> R<()> {
        let mut items = vec![];
        if let Some(o) = &wp.with_parameter_opt { wp_list(&o.with_parameter_list, &mut items); }
        for it in items {
            let name = it.identifier.identifier_token.to_string();
            let mut val = match (ov.get(&name), &it.with_parameter_item_opt) {
                (Some(v), _) => *v,
                (None, Some(o)) => self.const_of(sc, &toks(|c| c.expression(&o.expression)))?,
                _ => return Err(format!("parameter '{}' has no value", name)),
            };
            if let WithParameterItemGroup0::ArrayType(a) = &*it.with_parameter_item_group0 {
                if let Ok(ty) = self.parse_type(sc, &toks(|c| c.array_type(&a.array_type))) { val = val.resize(ty.w); }
            }
            sc.consts.insert(name, val);
        }
        Ok(())
    }

    /// types of an interface's variables (with its default parameters)
    pub fn iface_types(&self, iface: &str) -> R<HashMap<String, TypeInfo>> {
        let d = *self.ifaces.get(iface).ok_or(format!("unknown interface '{}'", iface))?;
        let mut sc = Scope::default();
        if let Some(wp) = &d.interface_declaration_opt1 { self.params(&mut sc, &wp.with_parameter, &HashMap::new())?; }
        let mut out = HashMap::new();
        for it in Self::iface_items(d) {
            match it {
                GenerateItem::ConstDeclaration(x) => { let c = &x.const_declaration; if let Ok(v) = self.const_of(&sc, &toks(|k| k.expression(&c.expression))) { sc.consts.insert(c.identifier.identifier_token.to_string(), v); } }
                GenerateItem::VarDeclaration(x) => {
                    let v = &x.var_declaration;
                    if let Some(o) = &v.var_declaration_opt { out.insert(v.identifier.identifier_token.to_string(), self.parse_type(&sc, &toks(|c| c.array_type(&o.array_type)))?); }
                }
                GenerateItem::LetDeclaration(x) => {
                    let l = &x.let_declaration;
                    if let Some(o) = &l.let_declaration_opt { out.insert(l.identifier.identifier_token.to_string(), self.parse_type(&sc, &toks(|c| c.array_type(&o.array_type)))?); }
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// the generate items of an interface (its modports left out)
    pub fn iface_items(d: &'a InterfaceDeclaration) -> Vec<&'a GenerateItem> { veryl_sim::iface::items(d) }

    /// members of modport `mp` of interface `iface` with their direction (seen from the module)
    pub fn modport(&self, iface: &str, mp: &str) -> R<Vec<(String, Dir)>> {
        let d = *self.ifaces.get(iface).ok_or(format!("unknown interface '{}'", iface))?;
        Ok(veryl_sim::iface::modport(d, mp)?.into_iter().map(|(n, out)| (n, if out { Dir::Out } else { Dir::In })).collect())
    }

    // ---------------- name resolution / parsing ----------------
    fn resolve(&self, sc: &Scope, path: &[String]) -> Option<Res> {
        let name = &path[0];
        if path.len() == 1 {
            if let Some(v) = sc.consts.get(name) { return Some(Res::Const(*v)); }
            if sc.fns.contains_key(name) { return Some(Res::Fn(name.clone())); }
            if let Some(q) = sc.imports.get(name) {
                if let Some(v) = self.consts.get(q) { return Some(Res::Const(*v)); }
            }
            // anything else is a signal / local; checked when it is evaluated
            return Some(Res::Sym(name.clone()));
        }
        let joined = path.join("::");
        if let Some(v) = self.consts.get(&joined) { return Some(Res::Const(*v)); }
        if let Some(q) = sc.imports.get(name) {
            let full = format!("{}::{}", q, path[1..].join("::"));
            if let Some(v) = self.consts.get(&full) { return Some(Res::Const(*v)); }
        }
        None
    }

    pub fn parse(&self, sc: &Scope, t: &[String]) -> R<Expr> {
        parse_expr(t, &|p| self.resolve(sc, p), &|sig, f| {
            sc.sigs.get(sig)?.ty.fields.iter().find(|(n, _, _)| n == f).map(|(_, lo, w)| (*lo, *w))
        })
    }

    pub fn const_of(&self, sc: &Scope, t: &[String]) -> R<Val> {
        let e = self.parse(sc, t)?;
        const_eval(&e)
    }

    /// Parse a type: logic<8>, bit, u32, clock, reset, Pkg::Enum, Pkg::Struct,
    /// imported names, optionally followed by an array size `[N]`.
    pub fn parse_type(&self, sc: &Scope, t: &[String]) -> R<TypeInfo> {
        let mut i = 0;
        let mut info = TypeInfo::scalar(1);
        while i < t.len() && matches!(t[i].as_str(), "tri" | "signed" | "default") {
            if t[i] == "signed" { info.signed = true; }
            i += 1;
        }
        let head = t.get(i).ok_or("missing type")?.as_str();
        let dims = |i: usize, close: &str| -> R<(u32, usize)> {
            let r = |p: &[String]| self.resolve(sc, p);
            let mut p = P { t, i, r: &r, f: &|_, _| None };
            let mut w = 1u128;
            loop {
                // `bin` (not `expr`) so the closing '>' is not taken as an operator
                let e = p.bin(0)?;
                w *= const_eval(&e)?.v.sat().max(1);
                match p.peek() { Some(",") => p.i += 1, _ => break }
            }
            if p.peek() != Some(close) { return Err(format!("expected '{}' in type", close)); }
            Ok((w.clamp(1, 1 << 20) as u32, p.i + 1))
        };
        match head {
            "logic" | "bit" => {
                if t.get(i + 1).map(|s| s.as_str()) == Some("<") {
                    let (w, ni) = dims(i + 2, ">")?;
                    info.w = w;
                    i = ni;
                } else { i += 1; }
            }
            "clock" | "clock_posedge" => { info.kind = Kind::Clock(true); i += 1; }
            "clock_negedge" => { info.kind = Kind::Clock(false); i += 1; }
            "reset" | "reset_async_low" => { info.kind = Kind::Reset { low: true, asynch: true }; i += 1; }
            "reset_async_high" => { info.kind = Kind::Reset { low: false, asynch: true }; i += 1; }
            "reset_sync_low" => { info.kind = Kind::Reset { low: true, asynch: false }; i += 1; }
            "reset_sync_high" => { info.kind = Kind::Reset { low: false, asynch: false }; i += 1; }
            "bool" => { i += 1; }
            h if h.len() > 1 && matches!(h.as_bytes()[0], b'u' | b'i') && h[1..].parse::<u32>().is_ok() => {
                info.w = h[1..].parse().unwrap();
                info.signed = h.starts_with('i');
                i += 1;
            }
            other => {
                let (qualified, n) = if t.get(i + 1).map(|s| s.as_str()) == Some("::") {
                    (format!("{}::{}", other, t.get(i + 2).ok_or("bad type")?), 3)
                } else if let Some(q) = sc.imports.get(other) {
                    (q.clone(), 1)
                } else {
                    return Err(format!("unsupported type '{}'", other));
                };
                let (pkg, ty) = qualified.split_once("::").unwrap();
                let p = self.pkgs.get(pkg).ok_or(format!("unknown package '{}'", pkg))?;
                if let Some(w) = p.enums.get(ty) {
                    info.w = *w;
                } else if let Some(fields) = p.structs.get(ty) {
                    // packed struct: the first field is the most significant
                    let total: u32 = fields.iter().map(|f| f.1).sum();
                    let mut hi = total;
                    for (fname, fw) in fields {
                        hi -= fw;
                        info.fields.push((fname.clone(), hi, *fw));
                    }
                    info.w = total;
                } else {
                    return Err(format!("unknown type '{}'", qualified));
                }
                i += n;
            }
        }
        if t.get(i).map(|s| s.as_str()) == Some("[") {
            let (n, _) = dims(i + 1, "]")?;
            info.arr = Some(n);
        }
        Ok(info)
    }
}

/// Fold a constant expression (params, bounds, enum values).
pub fn const_eval(e: &Expr) -> R<Val> {
    let mut b = Builder::new();
    let sc = Scope::default();
    let mut s = Synth::scratch(&mut b);
    let bits = s.eval(&sc, &Env::new(), e, 0)?;
    let v = const_of(&bits).ok_or("expression is not constant")?;
    Ok(Val::new(bits.len().max(1) as u32, v))
}

// ---------------- scopes and types ----------------

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind { Normal, Clock(bool), Reset { low: bool, asynch: bool } }

#[derive(Clone, Debug)]
pub struct TypeInfo {
    pub w: u32,
    pub signed: bool,
    pub kind: Kind,
    pub arr: Option<u32>,
    pub fields: Vec<(String, u32, u32)>,
}
impl TypeInfo {
    pub fn scalar(w: u32) -> Self { TypeInfo { w, signed: false, kind: Kind::Normal, arr: None, fields: vec![] } }
}

#[derive(Clone, Debug)]
pub struct SigInfo {
    /// placeholder wires (whole signal, arrays flattened element 0 first)
    pub bits: Vec<Bit>,
    pub ty: TypeInfo,
}

#[derive(Clone)]
pub struct FnDef {
    pub params: Vec<(String, TypeInfo)>,
    pub ret: Option<TypeInfo>,
    pub body: Vec<Stmt>,
}

#[derive(Default, Clone)]
pub struct Scope {
    pub prefix: String,
    pub consts: HashMap<String, Val>,
    pub sigs: HashMap<String, SigInfo>,
    /// declaration order (to find the default clock / reset)
    pub order: Vec<String>,
    pub fns: HashMap<String, Rc<FnDef>>,
    pub imports: HashMap<String, String>,
    pub ports: Vec<(String, Dir)>,
}

impl Scope {
    fn qual(&self, n: &str) -> String {
        if self.prefix.is_empty() { n.to_string() } else { format!("{}.{}", self.prefix, n) }
    }
}

// ---------------- statement IR ----------------

#[derive(Clone, Debug)]
pub enum Sel {
    All,
    Index(Expr),
    Range(Expr, Expr),
    Plus(Expr, Expr),
    Minus(Expr, Expr),
}

#[derive(Clone, Debug)]
pub enum CaseItem { V(Expr), R(Expr, Expr, bool) }

#[derive(Clone, Debug)]
pub enum Stmt {
    Set { name: String, sel: Sel, rhs: Expr },
    Local { name: String, w: u32 },
    If { arms: Vec<(Expr, Vec<Stmt>)>, els: Vec<Stmt> },
    IfReset { reset: Vec<Stmt>, arms: Vec<(Expr, Vec<Stmt>)>, els: Vec<Stmt> },
    Case { sel: Expr, arms: Vec<(Vec<CaseItem>, Vec<Stmt>)>, def: Vec<Stmt> },
    Switch { arms: Vec<(Vec<Expr>, Vec<Stmt>)>, def: Vec<Stmt> },
    Return(Expr),
}

/// current values of assigned signals / locals during symbolic execution
pub type Env = HashMap<String, Vec<Bit>>;

fn split_target(e: &Expr) -> R<(String, Sel)> {
    match e {
        Expr::Sym(n) => Ok((n.clone(), Sel::All)),
        Expr::Index(b, i) => match &**b {
            Expr::Sym(n) => Ok((n.clone(), Sel::Index((**i).clone()))),
            _ => Err("nested select in assignment target is not supported".into()),
        },
        Expr::Slice(b, x, y, k) => match &**b {
            Expr::Sym(n) => Ok((n.clone(), match k {
                0 => Sel::Range((**x).clone(), (**y).clone()),
                1 => Sel::Plus((**x).clone(), (**y).clone()),
                _ => Sel::Minus((**x).clone(), (**y).clone()),
            })),
            _ => Err("nested select in assignment target is not supported".into()),
        },
        _ => Err("unsupported assignment target".into()),
    }
}

// ---------------- syntax-tree list helpers ----------------

fn module_items<'b>(g: &'b ModuleGroup, out: &mut Vec<&'b GenerateItem>) {
    match &*g.module_group_group {
        ModuleGroupGroup::ModuleItem(x) => out.push(&x.module_item.generate_item),
        ModuleGroupGroup::LBraceModuleGroupGroupListRBrace(x) => {
            for y in &x.module_group_group_list { module_items(&y.module_group, out); }
        }
    }
}
fn gen_group<'b>(g: &'b GenerateGroup, out: &mut Vec<&'b GenerateItem>) {
    match &*g.generate_group_group {
        GenerateGroupGroup::GenerateItem(x) => out.push(&x.generate_item),
        GenerateGroupGroup::LBraceGenerateGroupGroupListRBrace(x) => {
            for y in &x.generate_group_group_list { gen_group(&y.generate_group, out); }
        }
    }
}
fn named_items(b: &GenerateNamedBlock) -> Vec<&GenerateItem> {
    let mut v = vec![];
    for l in &b.generate_named_block_list { gen_group(&l.generate_group, &mut v); }
    v
}
fn optional_items(b: &GenerateOptionalNamedBlock) -> Vec<&GenerateItem> {
    let mut v = vec![];
    for l in &b.generate_optional_named_block_list { gen_group(&l.generate_group, &mut v); }
    v
}
fn wp_list<'b>(l: &'b WithParameterList, out: &mut Vec<&'b WithParameterItem>) {
    wp_group(&l.with_parameter_group, out);
    for x in &l.with_parameter_list_list { wp_group(&x.with_parameter_group, out); }
}
fn wp_group<'b>(g: &'b WithParameterGroup, out: &mut Vec<&'b WithParameterItem>) {
    match &*g.with_parameter_group_group {
        WithParameterGroupGroup::WithParameterItem(x) => out.push(&x.with_parameter_item),
        WithParameterGroupGroup::LBraceWithParameterListRBrace(x) => wp_list(&x.with_parameter_list, out),
    }
}
fn pd_list<'b>(l: &'b PortDeclarationList, out: &mut Vec<&'b PortDeclarationItem>) {
    pd_group(&l.port_declaration_group, out);
    for x in &l.port_declaration_list_list { pd_group(&x.port_declaration_group, out); }
}
fn pd_group<'b>(g: &'b PortDeclarationGroup, out: &mut Vec<&'b PortDeclarationItem>) {
    match &*g.port_declaration_group_group {
        PortDeclarationGroupGroup::PortDeclarationItem(x) => out.push(&x.port_declaration_item),
        PortDeclarationGroupGroup::LBracePortDeclarationListRBrace(x) => pd_list(&x.port_declaration_list, out),
    }
}
type NamedToks = Vec<(String, Option<Vec<String>>)>;
fn ip_list(l: &InstParameterList, out: &mut NamedToks) {
    ip_group(&l.inst_parameter_group, out);
    for x in &l.inst_parameter_list_list { ip_group(&x.inst_parameter_group, out); }
}
fn ip_group(g: &InstParameterGroup, out: &mut NamedToks) {
    match &*g.inst_parameter_group_group {
        InstParameterGroupGroup::InstParameterItem(x) => {
            let it = &x.inst_parameter_item;
            out.push((it.identifier.identifier_token.to_string(),
                it.inst_parameter_item_opt.as_ref().map(|o| toks(|c| c.expression(&o.expression)))));
        }
        InstParameterGroupGroup::LBraceInstParameterListRBrace(x) => ip_list(&x.inst_parameter_list, out),
    }
}
fn ipo_list(l: &InstPortList, out: &mut NamedToks) {
    ipo_group(&l.inst_port_group, out);
    for x in &l.inst_port_list_list { ipo_group(&x.inst_port_group, out); }
}
fn ipo_group(g: &InstPortGroup, out: &mut NamedToks) {
    match &*g.inst_port_group_group {
        InstPortGroupGroup::InstPortItem(x) => {
            let it = &x.inst_port_item;
            out.push((it.identifier.identifier_token.to_string(),
                it.inst_port_item_opt.as_ref().map(|o| toks(|c| c.expression(&o.expression)))));
        }
        InstPortGroupGroup::LBraceInstPortListRBrace(x) => ipo_list(&x.inst_port_list, out),
    }
}

// ---------------- lowering: syntax tree -> statement IR ----------------

impl<'a> Lib<'a> {
    fn lower_block(&self, sc: &mut Scope, b: &StatementBlock) -> R<Vec<Stmt>> {
        let mut out = vec![];
        for l in &b.statement_block_list { self.lower_group(sc, &l.statement_block_group, &mut out)?; }
        Ok(out)
    }

    fn lower_group(&self, sc: &mut Scope, g: &StatementBlockGroup, out: &mut Vec<Stmt>) -> R<()> {
        match &*g.statement_block_group_group {
            StatementBlockGroupGroup::StatementBlockItem(x) => self.lower_item(sc, &x.statement_block_item, out),
            StatementBlockGroupGroup::BlockLBraceStatementBlockGroupGroupListRBrace(x) => {
                for y in &x.statement_block_group_group_list { self.lower_group(sc, &y.statement_block_group, out)?; }
                Ok(())
            }
        }
    }

    fn lower_item(&self, sc: &mut Scope, it: &StatementBlockItem, out: &mut Vec<Stmt>) -> R<()> {
        match it {
            StatementBlockItem::VarDeclaration(x) => {
                let v = &x.var_declaration;
                let name = v.identifier.identifier_token.to_string();
                let o = v.var_declaration_opt.as_ref().ok_or(format!("var '{}' needs a type", name))?;
                let ty = self.parse_type(sc, &toks(|c| c.array_type(&o.array_type)))?;
                out.push(Stmt::Local { name, w: ty.w * ty.arr.unwrap_or(1) });
                Ok(())
            }
            StatementBlockItem::ConstDeclaration(x) => {
                let c = &x.const_declaration;
                let v = self.const_of(sc, &toks(|k| k.expression(&c.expression)))?;
                sc.consts.insert(c.identifier.identifier_token.to_string(), v);
                Ok(())
            }
            StatementBlockItem::LetStatement(x) => {
                let l = &x.let_statement;
                let name = l.identifier.identifier_token.to_string();
                let rhs = self.parse(sc, &toks(|c| c.expression(&l.expression)))?;
                let w = match &l.let_statement_opt {
                    Some(o) => { let ty = self.parse_type(sc, &toks(|c| c.array_type(&o.array_type)))?; ty.w * ty.arr.unwrap_or(1) }
                    None => 0, // width of the value
                };
                out.push(Stmt::Local { name: name.clone(), w });
                out.push(Stmt::Set { name, sel: Sel::All, rhs });
                Ok(())
            }
            StatementBlockItem::Statement(x) => self.lower_stmt(sc, &x.statement, out),
            _ => Err("unsupported statement (gen / concatenation assignment)".into()),
        }
    }

    fn lower_stmt(&self, sc: &mut Scope, s: &Statement, out: &mut Vec<Stmt>) -> R<()> {
        match s {
            Statement::IdentifierStatement(x) => {
                let s = &x.identifier_statement;
                let lhs = toks(|c| c.expression_identifier(&s.expression_identifier));
                match &*s.identifier_statement_group {
                    IdentifierStatementGroup::FunctionCall(_) => {
                        if lhs.first().map(|t| t.starts_with('$')).unwrap_or(false) {
                            return Ok(()); // $display etc.: no hardware
                        }
                        Err(format!("function call statement `{}` is not synthesizable", lhs.join("")))
                    }
                    IdentifierStatementGroup::Assignment(a) => {
                        let a = &a.assignment;
                        let target = self.parse(sc, &lhs)?;
                        let (name, sel) = split_target(&target)?;
                        let rhs = self.parse(sc, &toks(|c| c.expression(&a.expression)))?;
                        let rhs = match &*a.assignment_group {
                            AssignmentGroup::Equ(_) => rhs,
                            AssignmentGroup::AssignmentOperator(o) => {
                                let op = toks(|c| c.assignment_operator(&o.assignment_operator)).join("");
                                Expr::Bin(op.trim_end_matches('=').to_string(), Box::new(target), Box::new(rhs))
                            }
                            _ => return Err("`<>` assignment is not supported".into()),
                        };
                        out.push(Stmt::Set { name, sel, rhs });
                        Ok(())
                    }
                }
            }
            Statement::IfStatement(x) => {
                let i = &x.if_statement;
                let mut arms = vec![(self.parse(sc, &toks(|c| c.expression(&i.expression)))?, self.lower_block(sc, &i.statement_block)?)];
                for e in &i.if_statement_list {
                    arms.push((self.parse(sc, &toks(|c| c.expression(&e.expression)))?, self.lower_block(sc, &e.statement_block)?));
                }
                let els = match &i.if_statement_opt { Some(o) => self.lower_block(sc, &o.statement_block)?, None => vec![] };
                out.push(Stmt::If { arms, els });
                Ok(())
            }
            Statement::IfResetStatement(x) => {
                let i = &x.if_reset_statement;
                let reset = self.lower_block(sc, &i.statement_block)?;
                let mut arms = vec![];
                for e in &i.if_reset_statement_list {
                    arms.push((self.parse(sc, &toks(|c| c.expression(&e.expression)))?, self.lower_block(sc, &e.statement_block)?));
                }
                let els = match &i.if_reset_statement_opt { Some(o) => self.lower_block(sc, &o.statement_block)?, None => vec![] };
                out.push(Stmt::IfReset { reset, arms, els });
                Ok(())
            }
            Statement::CaseStatement(x) => {
                let c = &x.case_statement;
                let sel = self.parse(sc, &toks(|k| k.expression(&c.expression)))?;
                let (mut arms, mut def) = (vec![], vec![]);
                for it in &c.case_statement_list {
                    let ci = &it.case_item;
                    let body = match &*ci.case_item_group0 {
                        CaseItemGroup0::Statement(s) => { let mut v = vec![]; self.lower_stmt(sc, &s.statement, &mut v)?; v }
                        CaseItemGroup0::StatementBlock(b) => self.lower_block(sc, &b.statement_block)?,
                    };
                    match &*ci.case_item_group {
                        CaseItemGroup::Defaul(_) => def = body,
                        CaseItemGroup::CaseCondition(cc) => {
                            let cc = &cc.case_condition;
                            let mut items = vec![self.range_item(sc, &cc.range_item.range)?];
                            for y in &cc.case_condition_list { items.push(self.range_item(sc, &y.range_item.range)?); }
                            arms.push((items, body));
                        }
                    }
                }
                out.push(Stmt::Case { sel, arms, def });
                Ok(())
            }
            Statement::SwitchStatement(x) => {
                let (mut arms, mut def) = (vec![], vec![]);
                for it in &x.switch_statement.switch_statement_list {
                    let si = &it.switch_item;
                    let body = match &*si.switch_item_group0 {
                        SwitchItemGroup0::Statement(s) => { let mut v = vec![]; self.lower_stmt(sc, &s.statement, &mut v)?; v }
                        SwitchItemGroup0::StatementBlock(b) => self.lower_block(sc, &b.statement_block)?,
                    };
                    match &*si.switch_item_group {
                        SwitchItemGroup::Defaul(_) => def = body,
                        SwitchItemGroup::SwitchCondition(cc) => {
                            let cc = &cc.switch_condition;
                            let mut conds = vec![self.parse(sc, &toks(|k| k.expression(&cc.expression)))?];
                            for y in &cc.switch_condition_list { conds.push(self.parse(sc, &toks(|k| k.expression(&y.expression)))?); }
                            arms.push((conds, body));
                        }
                    }
                }
                out.push(Stmt::Switch { arms, def });
                Ok(())
            }
            Statement::ForStatement(x) => {
                // loops are unrolled: the bounds must be constant
                let f = &x.for_statement;
                if f.for_statement_opt0.is_some() { return Err("`for ... step` is not supported".into()); }
                let var = f.identifier.identifier_token.to_string();
                let from = self.const_of(sc, &toks(|k| k.expression(&f.range.expression)))?.v.sat();
                let o = f.range.range_opt.as_ref().ok_or("for range needs `a..b`")?;
                let to = self.const_of(sc, &toks(|k| k.expression(&o.expression)))?.v.sat();
                let incl = toks(|k| k.range_operator(&o.range_operator)).join("") == "..=";
                let end = if incl { to + 1 } else { to };
                let mut idx: Vec<u128> = (from..end).collect();
                if f.for_statement_opt.is_some() { idx.reverse(); }
                let saved = sc.consts.get(&var).copied();
                for i in idx {
                    sc.consts.insert(var.clone(), Val::new(32, i));
                    out.extend(self.lower_block(sc, &f.statement_block)?);
                }
                match saved { Some(v) => { sc.consts.insert(var, v); } None => { sc.consts.remove(&var); } }
                Ok(())
            }
            Statement::ReturnStatement(x) => {
                out.push(Stmt::Return(self.parse(sc, &toks(|k| k.expression(&x.return_statement.expression)))?));
                Ok(())
            }
            _ => Err("unsupported statement (break)".into()),
        }
    }

    fn range_item(&self, sc: &Scope, r: &Range) -> R<CaseItem> {
        let lo = self.parse(sc, &toks(|k| k.expression(&r.expression)))?;
        match &r.range_opt {
            None => Ok(CaseItem::V(lo)),
            Some(o) => {
                let hi = self.parse(sc, &toks(|k| k.expression(&o.expression)))?;
                Ok(CaseItem::R(lo, hi, toks(|k| k.range_operator(&o.range_operator)).join("") == "..="))
            }
        }
    }

    fn lower_function(&self, sc: &Scope, f: &FunctionDeclaration) -> R<FnDef> {
        let name = f.identifier.identifier_token.to_string();
        let mut fsc = sc.clone();
        let mut params = vec![];
        if let Some(o) = &f.function_declaration_opt0 {
            let mut items = vec![];
            if let Some(p) = &o.port_declaration.port_declaration_opt { pd_list(&p.port_declaration_list, &mut items); }
            for it in items {
                let PortDeclarationItemGroup::PortTypeConcrete(pt) = &*it.port_declaration_item_group else {
                    return Err(format!("function '{}': interface arguments are not supported", name));
                };
                let pt = &pt.port_type_concrete;
                if !matches!(&*pt.direction, Direction::Input(_)) {
                    return Err(format!("function '{}': only input arguments are synthesizable", name));
                }
                let ty = self.parse_type(sc, &toks(|c| c.array_type(&pt.array_type)))?;
                let pname = it.identifier.identifier_token.to_string();
                // shadow module signals of the same name (struct fields resolve per name)
                fsc.sigs.insert(pname.clone(), SigInfo { bits: vec![], ty: ty.clone() });
                params.push((pname, ty));
            }
        }
        let ret = match &f.function_declaration_opt1 {
            Some(o) => Some(self.parse_type(sc, &toks(|c| c.scalar_type(&o.scalar_type)))?),
            None => None,
        };
        let body = self.lower_block(&mut fsc, &f.statement_block)?;
        Ok(FnDef { params, ret, body })
    }
}

// ---------------- synthesis ----------------

pub struct Synth<'l, 'a> {
    pub lib: Option<&'l Lib<'a>>,
    pub b: &'l mut Builder,
    /// placeholder wire -> its driver
    pub alias: HashMap<u32, Bit>,
    /// placeholder wires already driven (multi-driver check)
    driven: HashSet<u32>,
    pub nets: Vec<(String, Vec<Bit>)>,
    pub warnings: Vec<String>,
    /// instance hierarchy: (path, module), in elaboration order
    pub insts: Vec<(String, String)>,
    /// arrays that may become memories (block RAM), by hierarchical name
    mems: HashMap<String, MemInfo>,
    /// inside an always_ff: (block number, clock, rising edge)
    ff: Option<(usize, Bit, bool)>,
    ff_blocks: usize,
}

/// How an array is used, recorded while it is elaborated as flip-flops: if
/// it is written only as whole elements from one always_ff (at most one
/// write per cycle) and read only as whole elements, it is a memory with one
/// write port and read ports. The ports are kept as named nets
/// (`$mem:NAME:...`), so a technology mapper can replace the flip-flops by a
/// block RAM; nothing else changes.
#[derive(Default)]
struct MemInfo {
    bad: bool,
    /// (block, clock, rising edge, we, waddr, wdata)
    write: Option<(usize, Bit, bool, Bit, Vec<Bit>, Vec<Bit>)>,
    /// (address, data placeholder wires)
    reads: Vec<(Vec<Bit>, Vec<Bit>)>,
}

/// env keys of an array's pending write in an always_ff
fn mem_key(name: &str, what: &str) -> String { format!("{}$mem{}", name, what) }

/// pending write address / data: undefined until written (no mux needed for "no write")
fn dont_care(k: &str) -> bool { k.ends_with("$memwa") || k.ends_with("$memwd") }

impl<'l, 'a> Synth<'l, 'a> {
    pub fn new(lib: &'l Lib<'a>, b: &'l mut Builder) -> Self {
        Synth { lib: Some(lib), b, alias: HashMap::new(), driven: HashSet::new(), nets: vec![], warnings: vec![], insts: vec![], mems: HashMap::new(), ff: None, ff_blocks: 0 }
    }
    /// constant folding only (no library, no signals)
    fn scratch(b: &'l mut Builder) -> Self {
        Synth { lib: None, b, alias: HashMap::new(), driven: HashSet::new(), nets: vec![], warnings: vec![], insts: vec![], mems: HashMap::new(), ff: None, ff_blocks: 0 }
    }
    fn lib(&self) -> &'l Lib<'a> { self.lib.expect("library") }

    fn declare(&mut self, sc: &mut Scope, name: &str, ty: TypeInfo) -> Vec<Bit> {
        let total = ty.w * ty.arr.unwrap_or(1);
        let bits = self.b.wires(total);
        self.nets.push((sc.qual(name), bits.clone()));
        sc.sigs.insert(name.to_string(), SigInfo { bits: bits.clone(), ty });
        sc.order.push(name.to_string());
        bits
    }

    /// Record that placeholder bit `p` is driven by `d`.
    fn drive(&mut self, p: Bit, d: Bit, what: &str) -> R<()> {
        if p == d { return Ok(()); }
        let Bit::W(w) = p else { return Err(format!("'{}' cannot be driven", what)) };
        if !self.driven.insert(w) { return Err(format!("'{}' has multiple drivers", what)); }
        self.alias.insert(w, d);
        Ok(())
    }

    /// Commit the values a combinational block computed for module signals.
    fn commit(&mut self, sc: &Scope, env: &Env) -> R<()> {
        let mut names: Vec<&String> = env.keys().collect();
        names.sort();
        for n in names {
            let Some(si) = sc.sigs.get(n) else { continue };
            if si.bits.is_empty() { continue; }
            let v = &env[n];
            for (i, p) in si.bits.clone().iter().enumerate() {
                self.drive(*p, at(v, i), &sc.qual(n))?;
            }
        }
        Ok(())
    }

    // ---------------- module elaboration ----------------
    pub fn module(&mut self, m: &'a ModuleDeclaration, prefix: &str, ov: &HashMap<String, Val>) -> R<Scope> {
        let lib = self.lib();
        let mut sc = Scope { prefix: prefix.to_string(), ..Default::default() };

        if let Some(wp) = &m.module_declaration_opt1 { lib.params(&mut sc, &wp.with_parameter, ov)?; }

        let mut port_items = vec![];
        if let Some(pd) = &m.module_declaration_opt2 {
            if let Some(o) = &pd.port_declaration.port_declaration_opt { pd_list(&o.port_declaration_list, &mut port_items); }
        }
        for it in port_items {
            let name = it.identifier.identifier_token.to_string();
            let PortDeclarationItemGroup::PortTypeConcrete(pt) = &*it.port_declaration_item_group else {
                return Err(format!("port '{}': generic interface ports are not supported (name the modport)", name));
            };
            let pt = &pt.port_type_concrete;
            let dir = match &*pt.direction {
                Direction::Input(_) => Dir::In,
                Direction::Output(_) => Dir::Out,
                Direction::Modport(_) => {
                    // `bus: modport Bus::master`: one port per member, `bus.member`
                    let t = toks(|c| c.array_type(&pt.array_type));
                    let (iface, mp) = match t.as_slice() { [i, c, m] if c == "::" => (i.clone(), m.clone()), _ => return Err(format!("port '{}': expected modport Interface::name", name)) };
                    let types = lib.iface_types(&iface)?;
                    for (member, d) in lib.modport(&iface, &mp)? {
                        let ty = types.get(&member).cloned().ok_or_else(|| format!("modport {}::{}: no variable '{}'", iface, mp, member))?;
                        let full = format!("{}.{}", name, member);
                        self.declare(&mut sc, &full, ty);
                        sc.ports.push((full, d));
                    }
                    continue;
                }
                _ => return Err(format!("port '{}': only input/output/modport ports are supported", name)),
            };
            let ty = lib.parse_type(&sc, &toks(|c| c.array_type(&pt.array_type))).map_err(|e| format!("port '{}': {}", name, e))?;
            self.declare(&mut sc, &name, ty);
            sc.ports.push((name, dir));
        }

        let mut items = vec![];
        for l in &m.module_declaration_list { module_items(&l.module_group, &mut items); }
        self.items(&mut sc, &items)?;
        Ok(sc)
    }

    fn items(&mut self, sc: &mut Scope, items: &[&'a GenerateItem]) -> R<()> {
        for it in items { self.pass1(sc, it)?; }
        for it in items { self.pass2(sc, it)?; }
        Ok(())
    }

    /// declarations other items may refer to
    fn pass1(&mut self, sc: &mut Scope, it: &'a GenerateItem) -> R<()> {
        let lib = self.lib();
        match it {
            GenerateItem::VarDeclaration(x) => {
                let v = &x.var_declaration;
                let name = v.identifier.identifier_token.to_string();
                let o = v.var_declaration_opt.as_ref().ok_or(format!("var '{}' needs a type", name))?;
                let ty = lib.parse_type(sc, &toks(|c| c.array_type(&o.array_type))).map_err(|e| format!("var '{}': {}", name, e))?;
                self.declare(sc, &name, ty);
            }
            GenerateItem::LetDeclaration(x) => {
                let l = &x.let_declaration;
                if let Some(o) = &l.let_declaration_opt {
                    let ty = lib.parse_type(sc, &toks(|c| c.array_type(&o.array_type)))?;
                    self.declare(sc, &l.identifier.identifier_token.to_string(), ty);
                }
            }
            GenerateItem::ConstDeclaration(x) => {
                let c = &x.const_declaration;
                let mut v = lib.const_of(sc, &toks(|k| k.expression(&c.expression)))?;
                if let Some(o) = &c.const_declaration_opt {
                    if let ConstDeclarationOptGroup::ArrayType(a) = &*o.const_declaration_opt_group {
                        if let Ok(ty) = lib.parse_type(sc, &toks(|k| k.array_type(&a.array_type))) { v = v.resize(ty.w); }
                    }
                }
                sc.consts.insert(c.identifier.identifier_token.to_string(), v);
            }
            GenerateItem::ImportDeclaration(x) => {
                let d = &x.import_declaration;
                let pkg = toks(|c| c.scoped_identifier(&d.scoped_identifier)).join("");
                let names: Vec<String> = match &d.import_declaration_opt {
                    None => vec![],
                    Some(o) => match &*o.import_declaration_opt_group {
                        ImportDeclarationOptGroup::Star(_) => {
                            let mut v: Vec<String> = lib.pkgs.get(&pkg).map(|p| p.enums.keys().chain(p.structs.keys()).cloned().collect()).unwrap_or_default();
                            let pre = format!("{}::", pkg);
                            v.extend(lib.consts.keys().filter_map(|k| k.strip_prefix(&pre)).filter(|k| !k.contains("::")).map(|k| k.to_string()));
                            v
                        }
                        ImportDeclarationOptGroup::MultipleImportList(l) => {
                            let ml = &l.multiple_import_list;
                            let mut v = vec![ml.multiple_import_item.identifier.identifier_token.to_string()];
                            for y in &ml.multiple_import_list_list { v.push(y.multiple_import_item.identifier.identifier_token.to_string()); }
                            v
                        }
                    },
                };
                for n in names { sc.imports.insert(n.clone(), format!("{}::{}", pkg, n)); }
            }
            GenerateItem::FunctionDeclaration(x) => {
                let f = lib.lower_function(sc, &x.function_declaration)?;
                sc.fns.insert(x.function_declaration.identifier.identifier_token.to_string(), Rc::new(f));
            }
            _ => {}
        }
        Ok(())
    }

    /// behaviour
    fn pass2(&mut self, sc: &mut Scope, it: &'a GenerateItem) -> R<()> {
        let lib = self.lib();
        match it {
            GenerateItem::LetDeclaration(x) => {
                let l = &x.let_declaration;
                let name = l.identifier.identifier_token.to_string();
                let e = lib.parse(sc, &toks(|c| c.expression(&l.expression)))?;
                match sc.sigs.get(&name) {
                    Some(si) => {
                        let w = si.bits.len() as u32;
                        let v = self.eval(sc, &Env::new(), &e, w)?;
                        let v = self.fit(&v, w, self.signed(sc, &e));
                        let mut env = Env::new();
                        env.insert(name, v);
                        self.commit(sc, &env)?;
                    }
                    None => {
                        // untyped let: the signal is the value itself
                        let v = self.eval(sc, &Env::new(), &e, 0)?;
                        self.nets.push((sc.qual(&name), v.clone()));
                        sc.sigs.insert(name.clone(), SigInfo { bits: v.clone(), ty: TypeInfo::scalar(v.len() as u32) });
                    }
                }
            }
            GenerateItem::AssignDeclaration(x) => {
                let a = &x.assign_declaration;
                let AssignDestination::HierarchicalIdentifier(h) = &*a.assign_destination else {
                    return Err("concatenation as assign destination is not supported".into());
                };
                let target = lib.parse(sc, &toks(|c| c.hierarchical_identifier(&h.hierarchical_identifier)))?;
                let (name, sel) = split_target(&target)?;
                let rhs = lib.parse(sc, &toks(|c| c.expression(&a.expression)))?;
                let mut env = Env::new();
                self.exec(sc, &[Stmt::Set { name, sel, rhs }], &mut env)?;
                self.commit(sc, &env)?;
            }
            GenerateItem::AlwaysCombDeclaration(x) => {
                let body = lib.lower_block(sc, &x.always_comb_declaration.statement_block)?;
                let mut env = Env::new();
                self.exec(sc, &body, &mut env)?;
                self.commit(sc, &env)?;
            }
            GenerateItem::AlwaysFfDeclaration(x) => self.always_ff(sc, &x.always_ff_declaration)?,
            GenerateItem::InstDeclaration(x) => self.instantiate(sc, &x.inst_declaration)?,
            GenerateItem::GenerateForDeclaration(x) => {
                let g = &x.generate_for_declaration;
                let var = g.identifier.identifier_token.to_string();
                let label = g.generate_named_block.identifier.identifier_token.to_string();
                let from = lib.const_of(sc, &toks(|k| k.expression(&g.range.expression)))?.v.sat();
                let o = g.range.range_opt.as_ref().ok_or("generate for needs `a..b`")?;
                let to = lib.const_of(sc, &toks(|k| k.expression(&o.expression)))?.v.sat();
                let incl = toks(|k| k.range_operator(&o.range_operator)).join("") == "..=";
                let step = match &g.generate_for_declaration_opt0 {
                    Some(st) => Some((toks(|k| k.assignment_operator(&st.assignment_operator)).join(""), lib.const_of(sc, &toks(|k| k.expression(&st.expression)))?.v.sat())),
                    None => None,
                };
                let idx = veryl_sim::gen::for_indices(from, to, incl, g.generate_for_declaration_opt.is_some(), step.as_ref().map(|(o, k)| (o.as_str(), *k)))?;
                let items = named_items(&g.generate_named_block);
                for i in idx {
                    let mut inner = sc.clone();
                    inner.prefix = sc.qual(&format!("{}[{}]", label, i));
                    inner.consts.insert(var.clone(), Val::new(32, i));
                    self.items(&mut inner, &items)?;
                }
            }
            GenerateItem::GenerateIfDeclaration(x) => {
                let g = &x.generate_if_declaration;
                let truth = |sc: &Scope, e: &Expression| -> R<bool> { Ok(lib.const_of(sc, &toks(|k| k.expression(e)))?.v != 0) };
                let items = if truth(sc, &g.expression)? {
                    Some(named_items(&g.generate_named_block))
                } else {
                    let mut hit = None;
                    for e in &g.generate_if_declaration_list {
                        if truth(sc, &e.expression)? { hit = Some(optional_items(&e.generate_optional_named_block)); break; }
                    }
                    hit.or_else(|| g.generate_if_declaration_opt.as_ref().map(|o| optional_items(&o.generate_optional_named_block)))
                };
                if let Some(items) = items {
                    let mut inner = sc.clone();
                    self.items(&mut inner, &items)?;
                }
            }
            GenerateItem::GenerateBlockDeclaration(x) => {
                let mut inner = sc.clone();
                self.items(&mut inner, &named_items(&x.generate_block_declaration.generate_named_block))?;
            }
            GenerateItem::InitialDeclaration(_) | GenerateItem::FinalDeclaration(_) => {
                self.warnings.push(format!("{}: initial/final blocks are ignored by synthesis", if sc.prefix.is_empty() { "top" } else { &sc.prefix }));
            }
            GenerateItem::VarDeclaration(_) | GenerateItem::ConstDeclaration(_) | GenerateItem::ImportDeclaration(_)
            | GenerateItem::FunctionDeclaration(_) => {}
            _ => return Err("unsupported module item (interface/bind/connect/typedef/alias/unsafe)".into()),
        }
        Ok(())
    }

    fn instantiate(&mut self, sc: &mut Scope, d: &'a InstDeclaration) -> R<()> {
        let lib = self.lib();
        let ci = &d.component_instantiation;
        let iname = ci.identifier.identifier_token.to_string();
        let kind = toks(|c| c.scoped_identifier(&ci.scoped_identifier)).join("");
        if kind.starts_with("$tb::") {
            return Err(format!("'{}' is a testbench component ({}); pick a design module with --top", iname, kind));
        }
        if let Some(&d) = lib.ifaces.get(&kind) {
            // an interface instance: its variables become `inst.member` signals here
            self.insts.push((sc.qual(&iname), kind.clone()));
            let mut ov = HashMap::new();
            if let Some(p) = &ci.component_instantiation_opt1 {
                let mut v = vec![];
                if let Some(o) = &p.inst_parameter.inst_parameter_opt { ip_list(&o.inst_parameter_list, &mut v); }
                for (n, e) in v { ov.insert(n.clone(), match e { Some(t) => lib.const_of(sc, &t)?, None => *sc.consts.get(&n).ok_or(format!("parameter '{}' not found", n))? }); }
            }
            let mut isc = Scope { prefix: sc.qual(&iname), ..Default::default() };
            if let Some(wp) = &d.interface_declaration_opt1 { lib.params(&mut isc, &wp.with_parameter, &ov)?; }
            let items = Lib::iface_items(d);
            self.items(&mut isc, &items)?;
            let mut names: Vec<String> = isc.sigs.keys().cloned().collect();
            names.sort();
            for n in names { let si = isc.sigs[&n].clone(); sc.sigs.insert(format!("{}.{}", iname, n), si); }
            return Ok(());
        }
        let child = lib.modules.get(&kind).ok_or(format!("unknown module '{}'", kind))?.0;
        self.insts.push((sc.qual(&iname), kind.clone()));
        let mut ov = HashMap::new();
        if let Some(p) = &ci.component_instantiation_opt1 {
            let mut v = vec![];
            if let Some(o) = &p.inst_parameter.inst_parameter_opt { ip_list(&o.inst_parameter_list, &mut v); }
            for (n, e) in v {
                let val = match e {
                    Some(t) => lib.const_of(sc, &t)?,
                    None => *sc.consts.get(&n).ok_or(format!("parameter '{}' not found", n))?,
                };
                ov.insert(n, val);
            }
        }
        let mut conns: NamedToks = vec![];
        if let Some(p) = &ci.component_instantiation_opt2 {
            if let Some(o) = &p.inst_port.inst_port_opt { ipo_list(&o.inst_port_list, &mut conns); }
        }
        let csc = self.module(child, &sc.qual(&iname), &ov)?;
        for (pname, dir) in &csc.ports {
            let pbits = csc.sigs[pname].bits.clone();
            // a modport member `bus.valid` connects through the connection of `bus`
            let (base, member) = match pname.split_once('.') { Some((b, m)) => (b.to_string(), Some(m.to_string())), None => (pname.clone(), None) };
            let Some((_, expr)) = conns.iter().find(|(n, _)| *n == base) else {
                if *dir == Dir::In { self.warnings.push(format!("{}.{}: input port left unconnected", iname, pname)); }
                continue;
            };
            let mut t = expr.clone().unwrap_or_else(|| vec![base.clone()]);
            // `port: _` leaves an output unconnected
            if *dir == Dir::Out && t == ["_"] { continue; }
            if let Some(m) = member { t.push(".".into()); t.push(m); }
            let e = lib.parse(sc, &t)?;
            match dir {
                Dir::In => {
                    let w = pbits.len() as u32;
                    let v = self.eval(sc, &Env::new(), &e, w)?;
                    let v = self.fit(&v, w, self.signed(sc, &e));
                    for (i, p) in pbits.iter().enumerate() { self.drive(*p, v[i], &format!("{}.{}", csc.prefix, pname))?; }
                }
                Dir::Out => {
                    let (name, sel) = split_target(&e).map_err(|m| format!("{}.{}: output must connect to a signal ({})", iname, pname, m))?;
                    let mut env = Env::new();
                    self.write(sc, &mut env, &name, &sel, &pbits)?;
                    self.commit(sc, &env)?;
                }
            }
        }
        Ok(())
    }

    fn find_kind(&self, sc: &Scope, pred: impl Fn(Kind) -> bool) -> Option<String> {
        sc.order.iter().find(|n| sc.sigs.get(*n).map(|s| pred(s.ty.kind)).unwrap_or(false)).cloned()
    }

    fn always_ff(&mut self, sc: &mut Scope, a: &AlwaysFfDeclaration) -> R<()> {
        let lib = self.lib();
        let (mut clk, mut rst) = (None, None);
        if let Some(o) = &a.always_ff_declaration_opt {
            let ev = &o.always_ff_event_list;
            clk = Some(toks(|c| c.hierarchical_identifier(&ev.always_ff_clock.hierarchical_identifier)).join(""));
            if let Some(r) = &ev.always_ff_event_list_opt {
                rst = Some(toks(|c| c.hierarchical_identifier(&r.always_ff_reset.hierarchical_identifier)).join(""));
            }
        }
        let clk = match clk { Some(c) => c, None => self.find_kind(sc, |k| matches!(k, Kind::Clock(_))).ok_or("always_ff: no clock found")? };
        let ci = sc.sigs.get(&clk).ok_or(format!("unknown clock '{}'", clk))?;
        let pos = !matches!(ci.ty.kind, Kind::Clock(false));
        let ck = *ci.bits.first().ok_or("clock has no bits")?;

        let body = lib.lower_block(sc, &a.statement_block)?;
        let has_reset = matches!(body.first(), Some(Stmt::IfReset { .. }));
        if body.iter().skip(1).any(|s| matches!(s, Stmt::IfReset { .. })) || (has_reset && body.len() > 1) {
            return Err("if_reset must be the only top-level statement of always_ff".into());
        }
        let (mut env_n, mut env_r) = (Env::new(), Env::new());
        // pending memory writes of this block start as "no write"
        let arrays: Vec<(String, usize, usize)> = sc.sigs.iter().filter_map(|(n, si)| {
            let depth = si.ty.arr? as usize;
            (depth > 1 && !si.bits.is_empty()).then(|| (n.clone(), depth, si.ty.w as usize))
        }).collect();
        for env in [&mut env_n, &mut env_r] {
            for (n, depth, w) in &arrays {
                env.insert(mem_key(n, "we"), vec![Bit::C0]);
                let (wa, wd) = (self.b.wires(crate::netlist::bits_for(*depth).max(1) as u32), self.b.wires(*w as u32));
                env.insert(mem_key(n, "wa"), wa);
                env.insert(mem_key(n, "wd"), wd);
            }
        }
        self.ff_blocks += 1;
        self.ff = Some((self.ff_blocks, ck, pos));
        let reset = if let Some(Stmt::IfReset { reset, arms, els }) = body.first() {
            let rname = match rst { Some(r) => r, None => self.find_kind(sc, |k| matches!(k, Kind::Reset { .. })).ok_or("if_reset used without a reset signal")? };
            let ri = sc.sigs.get(&rname).ok_or(format!("unknown reset '{}'", rname))?;
            let (low, asynch) = match ri.ty.kind { Kind::Reset { low, asynch } => (low, asynch), _ => (true, true) };
            let rb = *ri.bits.first().ok_or("reset has no bits")?;
            self.exec(sc, reset, &mut env_r)?;
            self.exec(sc, &[Stmt::If { arms: arms.clone(), els: els.clone() }], &mut env_n)?;
            Some((rb, low, asynch))
        } else {
            self.exec(sc, &body, &mut env_n)?;
            None
        };
        self.ff = None;
        // the memory write port of this block (none during reset, as for the flip-flops)
        for (n, _, _) in &arrays {
            let we = env_n[&mem_key(n, "we")][0];
            if env_r[&mem_key(n, "we")][0] != Bit::C0 { self.mems.entry(sc.qual(n)).or_default().bad = true; }
            if we == Bit::C0 { continue; }
            let we = match reset { Some((rb, low, _)) => { let act = if low { self.b.not(rb) } else { rb }; let na = self.b.not(act); self.b.and(we, na) } None => we };
            let m = self.mems.entry(sc.qual(n)).or_default();
            if m.write.is_some() { m.bad = true; continue; }
            m.write = Some((self.ff_blocks, ck, pos, we, env_n[&mem_key(n, "wa")].clone(), env_n[&mem_key(n, "wd")].clone()));
        }

        let mut regs: Vec<String> = env_n.keys().chain(env_r.keys()).filter(|k| sc.sigs.contains_key(*k)).cloned().collect();
        regs.sort();
        regs.dedup();
        let c = if pos { 'P' } else { 'N' };
        for r in regs {
            let q = sc.sigs[&r].bits.clone();
            let full = sc.qual(&r);
            for (i, qb) in q.iter().enumerate() {
                let dn = env_n.get(&r).map(|v| at(v, i)).unwrap_or(*qb);
                let rv = env_r.get(&r).map(|v| at(v, i)).unwrap_or(*qb);
                let Bit::W(qw) = *qb else { continue };
                let mut conns = vec![("C", ck)];
                let typ = match reset {
                    None => {
                        if dn == *qb { continue; }
                        conns.push(("D", dn));
                        format!("$_DFF_{}_", c)
                    }
                    Some((rb, low, asynch)) => {
                        let rp = if low { 'N' } else { 'P' };
                        if rv == *qb || !rv.is_const() {
                            // no constant reset value: the reset is a mux in front of D
                            if asynch && rv != *qb { return Err(format!("'{}': asynchronous reset to a non-constant value", full)); }
                            let act = if low { self.b.not(rb) } else { rb };
                            let d = self.b.mux(act, dn, rv);
                            if d == *qb { continue; }
                            conns.push(("D", d));
                            format!("$_DFF_{}_", c)
                        } else {
                            let v = if rv == Bit::C1 { '1' } else { '0' };
                            conns.push(("D", dn));
                            conns.push(("R", rb));
                            if asynch { format!("$_DFF_{}{}{}_", c, rp, v) } else { format!("$_SDFF_{}{}{}_", c, rp, v) }
                        }
                    }
                };
                if !self.driven.insert(qw) { return Err(format!("'{}' has multiple drivers", full)); }
                conns.push(("Q", *qb));
                self.b.ff(typ, conns);
            }
        }
        Ok(())
    }

    // ---------------- symbolic execution ----------------

    /// inside always_ff, a module signal reads as its register output (the
    /// assignments are non-blocking), not as the value assigned so far
    fn registered(&self, sc: &Scope, n: &str) -> bool {
        self.ff.is_some() && sc.sigs.get(n).map(|s| !s.bits.is_empty()).unwrap_or(false)
    }

    /// current value of a signal / local
    fn cur(&self, sc: &Scope, env: &Env, name: &str) -> R<Vec<Bit>> {
        if let Some(v) = env.get(name) { return Ok(v.clone()); }
        match sc.sigs.get(name) {
            Some(si) if !si.bits.is_empty() || si.ty.w == 0 => Ok(si.bits.clone()),
            _ => Err(format!("undeclared signal '{}'", name)),
        }
    }

    fn elem_w(&self, sc: &Scope, _env: &Env, name: &str) -> Option<u32> {
        sc.sigs.get(name).filter(|s| s.ty.arr.is_some()).map(|s| s.ty.w)
    }

    fn cval(&mut self, sc: &Scope, env: &Env, e: &Expr) -> R<usize> {
        let v = self.eval(sc, env, e, 0)?;
        const_of(&v).map(|x| x as usize).ok_or_else(|| "select bounds must be constant".into())
    }

    /// resize to `w` bits (sign-extending signed values)
    fn fit(&self, v: &[Bit], w: u32, signed: bool) -> Vec<Bit> {
        if signed { sext(v, w as usize) } else { pad(v, w as usize) }
    }

    fn target_w(&mut self, sc: &Scope, env: &Env, name: &str, sel: &Sel) -> R<u32> {
        let total = self.cur(sc, env, name).map(|v| v.len() as u32).unwrap_or(0);
        Ok(match sel {
            Sel::All => total,
            Sel::Index(_) => self.elem_w(sc, env, name).unwrap_or(1),
            Sel::Range(x, y) => (self.cval(sc, env, x)? as u32).saturating_sub(self.cval(sc, env, y)? as u32) + 1,
            Sel::Plus(_, n) | Sel::Minus(_, n) => self.cval(sc, env, n)? as u32,
        })
    }

    /// env[name] = cur with `sel` replaced by `val`
    fn write(&mut self, sc: &Scope, env: &mut Env, name: &str, sel: &Sel, val: &[Bit]) -> R<()> {
        if let Some(ew) = self.elem_w(sc, env, name) {
            if sc.sigs.get(name).map(|s| !s.bits.is_empty()).unwrap_or(false) {
                let key = sc.qual(name);
                let we = mem_key(name, "we");
                let ok = matches!(sel, Sel::Index(_)) && val.len() == ew as usize && self.ff.is_some()
                    && env.get(&we).map(|v| v[0] == Bit::C0).unwrap_or(false) && !env.contains_key("$done");
                if ok {
                    let Sel::Index(i) = sel else { unreachable!() };
                    let idx = self.eval(sc, env, i, 0)?;
                    let wa = env[&mem_key(name, "wa")].len();
                    // an index wider than the array could point past it: no memory then
                    if idx.iter().skip(wa).any(|b| *b != Bit::C0) { self.mems.entry(key.clone()).or_default().bad = true; }
                    env.insert(we, vec![Bit::C1]);
                    env.insert(mem_key(name, "wa"), pad(&idx, wa));
                    env.insert(mem_key(name, "wd"), val.to_vec());
                } else {
                    self.mems.entry(key).or_default().bad = true;
                }
            }
        }
        let cur = self.cur(sc, env, name)?;
        let w = cur.len();
        let mut nv = cur.clone();
        match sel {
            Sel::All => nv = pad(val, w),
            Sel::Index(i) => {
                let ew = self.elem_w(sc, env, name).unwrap_or(1) as usize;
                let idx = self.eval(sc, env, i, 0)?;
                let n = w / ew;
                for k in 0..n {
                    let hit = match const_of(&idx) { Some(c) => Bit::of(c as usize == k), None => self.b.decode(&idx, k) };
                    for j in 0..ew { nv[k * ew + j] = self.b.mux(hit, cur[k * ew + j], at(val, j)); }
                }
            }
            Sel::Range(x, y) | Sel::Plus(x, y) | Sel::Minus(x, y) => {
                let (a, b) = (self.cval(sc, env, x)?, self.cval(sc, env, y)?);
                let (hi, lo) = match sel { Sel::Range(..) => (a, b), Sel::Plus(..) => (a + b - 1, a), _ => (a, a + 1 - b) };
                if hi < lo || hi >= w { return Err(format!("select [{}:{}] out of range for '{}'", hi, lo, name)); }
                for k in lo..=hi { nv[k] = at(val, k - lo); }
            }
        }
        // after a `return`, later assignments must not take effect
        if let Some(d) = env.get("$done").map(|v| v[0]) {
            if d != Bit::C0 && name != "$done" { nv = self.b.muxv(d, &nv, &cur); }
        }
        env.insert(name.to_string(), nv);
        Ok(())
    }

    pub fn exec(&mut self, sc: &Scope, stmts: &[Stmt], env: &mut Env) -> R<()> {
        for s in stmts {
            match s {
                Stmt::Set { name, sel, rhs } => {
                    if let Some(si) = sc.sigs.get(name) {
                        if !env.contains_key(name) && si.bits.is_empty() && si.ty.w > 0 {
                            return Err(format!("'{}' is not assignable here", name));
                        }
                    }
                    let tw = if env.get(name).map(|v| v.is_empty()).unwrap_or(false) { 0 } else { self.target_w(sc, env, name, sel)? };
                    let v = self.eval(sc, env, rhs, tw)?;
                    if tw == 0 { env.insert(name.clone(), v); continue; } // untyped local let
                    let v = self.fit(&v, tw, self.signed(sc, rhs));
                    self.write(sc, env, name, sel, &v)?;
                }
                Stmt::Local { name, w } => { env.insert(name.clone(), vec![Bit::C0; *w as usize]); }
                Stmt::If { arms, els } => {
                    let mut conds = vec![];
                    for (c, body) in arms {
                        let v = self.eval(sc, env, c, 0)?;
                        conds.push((self.b.reduce_or(&v), body.as_slice()));
                    }
                    self.exec_chain(sc, &conds, els, env)?;
                }
                Stmt::IfReset { .. } => return Err("if_reset is only allowed at the top of always_ff".into()),
                Stmt::Case { sel, arms, def } => {
                    let sv = self.eval(sc, env, sel, 0)?;
                    let mut conds = vec![];
                    // distinct constant labels are mutually exclusive: parallel one-hot merge
                    let mut labels: Vec<u128> = vec![];
                    let mut exclusive = true;
                    for (items, body) in arms {
                        let mut hit = Bit::C0;
                        for it in items {
                            let h = match it {
                                CaseItem::V(e) => {
                                    let v = self.eval(sc, env, e, 0)?;
                                    match const_of(&v) {
                                        Some(k) if !labels.contains(&k) => labels.push(k),
                                        _ => exclusive = false,
                                    }
                                    self.b.eq(&sv, &v)
                                }
                                CaseItem::R(lo, hi, incl) => {
                                    let (l, h) = (self.eval(sc, env, lo, 0)?, self.eval(sc, env, hi, 0)?);
                                    let w = sv.len().max(l.len()).max(h.len());
                                    let ge = { let lt = self.b.ult(&pad(&sv, w), &pad(&l, w)); self.b.not(lt) };
                                    let below = if *incl { let gt = self.b.ult(&pad(&h, w), &pad(&sv, w)); self.b.not(gt) } else { self.b.ult(&pad(&sv, w), &pad(&h, w)) };
                                    exclusive = false;
                                    self.b.and(ge, below)
                                }
                            };
                            hit = self.b.or(hit, h);
                        }
                        conds.push((hit, body.as_slice()));
                    }
                    if exclusive { self.exec_onehot(sc, &conds, def, env)?; } else { self.exec_chain(sc, &conds, def, env)?; }
                }
                Stmt::Switch { arms, def } => {
                    let mut conds = vec![];
                    for (cs, body) in arms {
                        let mut hit = Bit::C0;
                        for c in cs { let v = self.eval(sc, env, c, 0)?; let r = self.b.reduce_or(&v); hit = self.b.or(hit, r); }
                        conds.push((hit, body.as_slice()));
                    }
                    self.exec_chain(sc, &conds, def, env)?;
                }
                Stmt::Return(e) => {
                    let w = env.get("$ret").map(|v| v.len() as u32).ok_or("return outside a function")?;
                    let v = self.eval(sc, env, e, w)?;
                    let v = self.fit(&v, w, self.signed(sc, e));
                    self.write(sc, env, "$ret", &Sel::All, &v)?;
                    env.insert("$done".into(), vec![Bit::C1]);
                }
            }
        }
        Ok(())
    }

    /// if / else-if / else chain: each branch runs on a copy of the
    /// environment and the results are merged with muxes
    fn exec_chain(&mut self, sc: &Scope, conds: &[(Bit, &[Stmt])], els: &[Stmt], env: &mut Env) -> R<()> {
        let Some(((c, body), rest)) = conds.split_first() else { return self.exec(sc, els, env) };
        match *c {
            Bit::C1 => return self.exec(sc, body, env),
            Bit::C0 => return self.exec_chain(sc, rest, els, env),
            _ => {}
        }
        let mut et = env.clone();
        self.exec(sc, body, &mut et)?;
        let mut ef = env.clone();
        self.exec_chain(sc, rest, els, &mut ef)?;
        let mut keys: Vec<String> = et.keys().chain(ef.keys()).cloned().collect();
        keys.sort();
        keys.dedup();
        for k in keys {
            // locals declared inside a branch die with it
            if !env.contains_key(&k) && !sc.sigs.contains_key(&k) { continue; }
            let (t, f) = (et.get(&k), ef.get(&k));
            if t == f { if let Some(t) = t { env.insert(k, t.clone()); } continue; }
            let base = self.cur(sc, env, &k)?;
            let t = t.cloned().unwrap_or_else(|| base.clone());
            let f = f.cloned().unwrap_or(base.clone());
            // a memory's write address / data only matter where it writes
            if dont_care(&k) && (t == base || f == base) { env.insert(k, if t == base { f } else { t }); continue; }
            let m = self.b.muxv(*c, &f, &t);
            env.insert(k, m);
        }
        Ok(())
    }

    /// branches with mutually exclusive conditions: every result bit is
    /// OR_i(hit_i & value_i) | (no hit & default), a balanced tree instead of
    /// the priority mux chain of `exec_chain`
    fn exec_onehot(&mut self, sc: &Scope, conds: &[(Bit, &[Stmt])], def: &[Stmt], env: &mut Env) -> R<()> {
        let mut envs = vec![];
        for (c, body) in conds {
            if *c == Bit::C0 { continue; }
            let mut e = env.clone();
            self.exec(sc, body, &mut e)?;
            envs.push((*c, e));
        }
        let hits: Vec<Bit> = envs.iter().map(|x| x.0).collect();
        let any = self.b.reduce_or(&hits);
        let none = self.b.not(any);
        let mut ed = env.clone();
        self.exec(sc, def, &mut ed)?;
        envs.push((none, ed));
        let mut keys: Vec<String> = envs.iter().flat_map(|(_, e)| e.keys().cloned()).collect();
        keys.sort();
        keys.dedup();
        for k in keys {
            if !env.contains_key(&k) && !sc.sigs.contains_key(&k) { continue; }
            let base = self.cur(sc, env, &k)?;
            let vals: Vec<Vec<Bit>> = envs.iter().map(|(_, e)| e.get(&k).cloned().unwrap_or_else(|| base.clone())).collect();
            if vals.iter().all(|v| *v == base) { continue; }
            let arms: Vec<(Bit, &Vec<Bit>)> = envs.iter().zip(&vals).filter(|(_, v)| !dont_care(&k) || **v != base).map(|((h, _), v)| (*h, v)).collect();
            if dont_care(&k) && arms.len() == 1 { env.insert(k, arms[0].1.clone()); continue; }
            let w = vals.iter().map(|v| v.len()).max().unwrap_or(0);
            // arms with the same value share one select; a signal most arms leave alone
            // (a register held in other states) becomes a 2-way mux: changed ? new : old
            let mut groups: Vec<(Vec<Bit>, &Vec<Bit>)> = vec![];
            for (h, v) in &arms {
                match groups.iter_mut().find(|g| g.1 == *v) { Some(g) => g.0.push(*h), None => groups.push((vec![*h], *v)) }
            }
            let hold = groups.iter().position(|g| *g.1 == base);
            let sel: Vec<(Bit, &Vec<Bit>)> = groups.iter().enumerate().filter(|(i, _)| Some(*i) != hold).map(|(_, g)| (self.b.reduce_or(&g.0), g.1)).collect();
            let changed = if hold.is_some() { Some(self.b.reduce_or(&sel.iter().map(|x| x.0).collect::<Vec<_>>())) } else { None };
            let mut out = vec![];
            for i in 0..w {
                let terms: Vec<Bit> = sel.iter().map(|(h, v)| if sel.len() == 1 && changed.is_some() { at(v, i) } else { self.b.and(*h, at(v, i)) }).collect();
                let new = self.b.reduce_or(&terms);
                out.push(match changed { Some(c) => self.b.mux(c, at(&base, i), new), None => new });
            }
            env.insert(k, out);
        }
        Ok(())
    }

    fn call(&mut self, sc: &Scope, f: &FnDef, args: Vec<Vec<Bit>>, name: &str) -> R<Vec<Bit>> {
        if args.len() != f.params.len() { return Err(format!("function '{}' expects {} arguments", name, f.params.len())); }
        let ret = f.ret.as_ref().ok_or(format!("function '{}' has no return value", name))?;
        let mut env = Env::new();
        for ((p, ty), v) in f.params.iter().zip(args) { env.insert(p.clone(), self.fit(&v, ty.w, ty.signed)); }
        env.insert("$ret".into(), vec![Bit::C0; ret.w as usize]);
        env.insert("$done".into(), vec![Bit::C0]);
        let mut fsc = sc.clone();
        for (p, ty) in &f.params { fsc.sigs.insert(p.clone(), SigInfo { bits: vec![], ty: ty.clone() }); }
        self.exec(&fsc, &f.body, &mut env)?;
        Ok(env.remove("$ret").unwrap())
    }

    /// is the expression signed (Verilog rules: all operands signed)?
    pub fn signed(&self, sc: &Scope, e: &Expr) -> bool {
        match e {
            Expr::Num(v) => v.s,
            Expr::Sym(n) => sc.sigs.get(n).map(|s| s.ty.signed).unwrap_or(false),
            Expr::Call(n, _) => n == "$signed",
            Expr::Un(op, a) => matches!(op.as_str(), "-" | "+" | "~") && self.signed(sc, a),
            Expr::Bin(op, a, b) => matches!(op.as_str(), "+" | "-" | "*" | "&" | "|" | "^") && self.signed(sc, a) && self.signed(sc, b),
            Expr::Tern(_, a, b) => self.signed(sc, a) && self.signed(sc, b),
            _ => false,
        }
    }

    /// Evaluate an expression to bits; `ctx` is the context width (0 = self-determined).
    pub fn eval(&mut self, sc: &Scope, env: &Env, e: &Expr, ctx: u32) -> R<Vec<Bit>> {
        Ok(match e {
            Expr::Num(v) => const_bits(v.v, v.w),
            Expr::AllBit(b) => vec![Bit::of(*b == 1); ctx.max(1) as usize],
            Expr::Str(_) => return Err("string literals are not synthesizable".into()),
            Expr::Sym(n) => {
                if let Some(v) = env.get(n) { if !self.registered(sc, n) { return Ok(v.clone()); } }
                if let Some(si) = sc.sigs.get(n) {
                    if si.bits.is_empty() && si.ty.w > 0 { return Err(format!("'{}' is not readable here", n)); }
                    if si.ty.arr.is_some() { self.mems.entry(sc.qual(n)).or_default().bad = true; }
                    return Ok(si.bits.clone());
                }
                if let Some(v) = sc.consts.get(n) { return Ok(const_bits(v.v, v.w)); }
                return Err(format!("undeclared identifier '{}'", n));
            }
            Expr::Index(b, i) => {
                let idx = self.eval(sc, env, i, 0)?;
                let (base, ew) = match &**b {
                    Expr::Sym(n) => match self.elem_w(sc, env, n) {
                        Some(ew) if self.registered(sc, n) => (sc.sigs[n].bits.clone(), ew as usize),
                        Some(ew) => (self.cur(sc, env, n)?, ew as usize),
                        None => (self.eval(sc, env, b, 0)?, 1),
                    },
                    _ => (self.eval(sc, env, b, 0)?, 1),
                };
                let elems: Vec<Vec<Bit>> = base.chunks(ew).map(|c| c.to_vec()).collect();
                if elems.is_empty() { return Err("select on an empty value".into()); }
                let v = self.b.select(&elems, &idx);
                // an element read of an array: a memory read port (placeholders aliased to the mux tree)
                if let Expr::Sym(n) = &**b {
                    if ew > 1 || elems.len() > 1 {
                        if let Some(si) = sc.sigs.get(n).filter(|s| s.ty.arr.is_some() && !s.bits.is_empty()) {
                            let _ = si;
                            let key = sc.qual(n);
                            // read after a write in a combinational block: not a memory
                            if env.contains_key(n) && !self.registered(sc, n) { self.mems.entry(key).or_default().bad = true; return Ok(v); }
                            if let Some((_, r)) = self.mems.get(&key).and_then(|m| m.reads.iter().find(|(a, _)| *a == idx)) { return Ok(r.clone()); }
                            let r = self.b.wires(v.len() as u32);
                            for (p, d) in r.iter().zip(&v) { if let Bit::W(w) = p { self.alias.insert(*w, *d); } }
                            self.mems.entry(key).or_default().reads.push((idx, r.clone()));
                            return Ok(r);
                        }
                    }
                }
                v
            }
            Expr::Slice(b, x, y, k) => {
                let base = self.eval(sc, env, b, 0)?;
                match k {
                    0 => {
                        let (hi, lo) = (self.cval(sc, env, x)?, self.cval(sc, env, y)?);
                        if hi < lo { return Err("bad slice range".into()); }
                        (lo..=hi).map(|i| at(&base, i)).collect()
                    }
                    _ => {
                        let n = self.cval(sc, env, y)?;
                        let xv = self.eval(sc, env, x, 0)?;
                        let lo: Vec<Bit> = if *k == 1 { xv } else {
                            let off = const_bits((n as u128).wrapping_sub(1), xv.len().max(32) as u32);
                            self.b.sub(&pad(&xv, off.len()), &off)
                        };
                        let sh = self.b.shift(&base, &lo, false, Bit::C0);
                        pad(&sh, n)
                    }
                }
            }
            Expr::Un(op, a) => {
                match op.as_str() {
                    "~" | "-" | "+" => {
                        let v = self.eval(sc, env, a, ctx)?;
                        let w = (ctx as usize).max(v.len());
                        let v = self.fit(&v, w as u32, self.signed(sc, a));
                        match op.as_str() { "~" => self.b.notv(&v), "-" => self.b.neg(&v), _ => v }
                    }
                    _ => {
                        let v = self.eval(sc, env, a, 0)?;
                        let r = match op.trim_start_matches('~') {
                            "!" | "|" => self.b.reduce_or(&v),
                            "&" => self.b.reduce_and(&v),
                            "^" => self.b.reduce_xor(&v),
                            o => return Err(format!("unary operator '{}' not supported", o)),
                        };
                        vec![if op == "!" || op.starts_with('~') { self.b.not(r) } else { r }]
                    }
                }
            }
            Expr::Bin(op, a, b) => self.eval_bin(sc, env, op, a, b, ctx)?,
            Expr::Tern(c, a, b) => {
                let cv = self.eval(sc, env, c, 0)?;
                let s = self.b.reduce_or(&cv);
                let (av, bv) = (self.eval(sc, env, a, ctx)?, self.eval(sc, env, b, ctx)?);
                let w = (ctx as usize).max(av.len()).max(bv.len()) as u32;
                let sg = self.signed(sc, a) && self.signed(sc, b);
                let (av, bv) = (self.fit(&av, w, sg), self.fit(&bv, w, sg));
                self.b.muxv(s, &bv, &av)
            }
            Expr::Concat(items) => {
                // msb-first in source, lsb-first in our vectors
                let mut out = vec![];
                for (cnt, it) in items.iter().rev() {
                    let n = self.cval(sc, env, cnt)?;
                    let v = self.eval(sc, env, it, 0)?;
                    for _ in 0..n { out.extend(v.iter().copied()); }
                }
                out
            }
            Expr::Call(name, args) => {
                match name.as_str() {
                    "$signed" | "$unsigned" => {
                        let a = args.first().ok_or("missing argument")?;
                        return self.eval(sc, env, a, 0);
                    }
                    "$clog2" => {
                        let v = self.cval(sc, env, args.first().ok_or("missing argument")?)?;
                        return Ok(const_bits(bits_for(v) as u128, 32));
                    }
                    "$bits" | "$size" => {
                        let v = self.eval(sc, env, args.first().ok_or("missing argument")?, 0)?;
                        return Ok(const_bits(v.len() as u128, 32));
                    }
                    _ => {}
                }
                let f = sc.fns.get(name).cloned().ok_or(format!("'{}' is not synthesizable", name))?;
                let mut vals = vec![];
                for (i, a) in args.iter().enumerate() {
                    let w = f.params.get(i).map(|p| p.1.w).unwrap_or(0);
                    vals.push(self.eval(sc, env, a, w)?);
                }
                self.call(sc, &f, vals, name)?
            }
        })
    }

    fn eval_bin(&mut self, sc: &Scope, env: &Env, op: &str, a: &Expr, b: &Expr, ctx: u32) -> R<Vec<Bit>> {
        let sg = self.signed(sc, a) && self.signed(sc, b);
        match op {
            "&&" | "||" => {
                let (av, bv) = (self.eval(sc, env, a, 0)?, self.eval(sc, env, b, 0)?);
                let (x, y) = (self.b.reduce_or(&av), self.b.reduce_or(&bv));
                Ok(vec![if op == "&&" { self.b.and(x, y) } else { self.b.or(x, y) }])
            }
            "==" | "!=" | "===" | "!==" | "==?" | "!=?" | "<:" | "<=" | ">:" | ">=" => {
                let (av, bv) = (self.eval(sc, env, a, 0)?, self.eval(sc, env, b, 0)?);
                let w = av.len().max(bv.len()) as u32;
                let (av, bv) = (self.fit(&av, w, sg), self.fit(&bv, w, sg));
                let lt = |s: &mut Self, x: &[Bit], y: &[Bit]| if sg { s.b.slt(x, y) } else { s.b.ult(x, y) };
                let r = match op {
                    "<:" => lt(self, &av, &bv),
                    ">:" => lt(self, &bv, &av),
                    "<=" => { let g = lt(self, &bv, &av); self.b.not(g) }
                    ">=" => { let l = lt(self, &av, &bv); self.b.not(l) }
                    _ => {
                        let e = self.b.eq(&av, &bv);
                        if op.starts_with('=') { e } else { self.b.not(e) }
                    }
                };
                Ok(vec![r])
            }
            "<<" | "<<<" | ">>" | ">>>" => {
                let av = self.eval(sc, env, a, ctx)?;
                let w = (ctx as usize).max(av.len());
                let sa = self.signed(sc, a);
                let av = self.fit(&av, w as u32, sa);
                let amt = self.eval(sc, env, b, 0)?;
                let left = op.starts_with("<<");
                let fill = if op == ">>>" && sa { *av.last().unwrap_or(&Bit::C0) } else { Bit::C0 };
                Ok(match const_of(&amt) {
                    Some(n) => shift_const(&av, n.min(w as u128) as usize, left, fill),
                    None => self.b.shift(&av, &amt, left, fill),
                })
            }
            _ => {
                let (av, bv) = (self.eval(sc, env, a, ctx)?, self.eval(sc, env, b, ctx)?);
                let w = (ctx as usize).max(av.len()).max(bv.len()) as u32;
                let (av, bv) = (self.fit(&av, w, sg), self.fit(&bv, w, sg));
                Ok(match op {
                    "&" => av.iter().zip(&bv).map(|(x, y)| self.b.and(*x, *y)).collect(),
                    "|" => av.iter().zip(&bv).map(|(x, y)| self.b.or(*x, *y)).collect(),
                    "^" => av.iter().zip(&bv).map(|(x, y)| self.b.xor(*x, *y)).collect(),
                    "~^" | "^~" => av.iter().zip(&bv).map(|(x, y)| self.b.xnor(*x, *y)).collect(),
                    "+" => self.b.add(&av, &bv),
                    "-" => self.b.sub(&av, &bv),
                    "*" => self.b.mul(&av, &bv),
                    "/" | "%" => {
                        let (q, r) = if sg { self.b.sdivmod(&av, &bv) } else { self.b.udivmod(&av, &bv) };
                        if op == "/" { q } else { r }
                    }
                    "**" => {
                        let (Some(x), Some(y)) = (const_of(&av), const_of(&bv)) else {
                            return Err("operator '**' is only synthesizable on constants".into());
                        };
                        const_bits(x.wrapping_pow(y as u32), w)
                    }
                    o => return Err(format!("operator '{}' not supported", o)),
                })
            }
        }
    }
}

/// Synthesize `top` into a flat, optimized gate-level netlist.
pub fn synthesize(lib: &Lib, top: &str) -> R<(Netlist, Vec<String>)> {
    synthesize_with(lib, top, &HashMap::new())
}

/// `synthesize` with the top's parameters overridden
pub fn synthesize_with(lib: &Lib, top: &str, ov: &HashMap<String, Val>) -> R<(Netlist, Vec<String>)> {
    let st = synthesize_stages_with(lib, top, ov)?;
    Ok((st.opt, st.warnings))
}

/// Every step of synthesis, for viewing: the instance hierarchy, the gate
/// netlist as elaborated (aliases resolved, nothing optimized away yet) and
/// the optimized netlist.
pub struct Stages {
    /// (path, module); the top is ("", top)
    pub insts: Vec<(String, String)>,
    /// top-level ports: (name, direction, width)
    pub ports: Vec<(String, Dir, usize)>,
    /// named signals: (hierarchical name, width)
    pub signals: Vec<(String, usize)>,
    pub raw: Netlist,
    pub opt: Netlist,
    pub warnings: Vec<String>,
}

pub fn synthesize_stages(lib: &Lib, top: &str) -> R<Stages> { synthesize_stages_with(lib, top, &HashMap::new()) }

pub fn synthesize_stages_with(lib: &Lib, top: &str, ov: &HashMap<String, Val>) -> R<Stages> {
    let (m, _) = lib.modules.get(top).ok_or(format!("module '{}' not found", top))?;
    let mut b = Builder::new();
    let mut s = Synth::new(lib, &mut b);
    let sc = s.module(m, "", ov)?;
    let ports: Vec<Port> = sc.ports.iter().map(|(n, d)| Port { name: n.clone(), dir: *d, bits: sc.sigs[n].bits.clone() }).collect();
    let mut insts = vec![(String::new(), top.to_string())];
    insts.extend(std::mem::take(&mut s.insts));
    // memories (see MemInfo) as named nets for the technology mappers
    let mut mems: Vec<(&String, &MemInfo)> = s.mems.iter().filter(|(_, m)| !m.bad && !m.reads.is_empty() && m.write.as_ref().map(|w| w.2).unwrap_or(false)).collect();
    mems.sort_by(|a, b| a.0.cmp(b.0));
    let mut mem_nets = vec![];
    for (q, m) in mems {
        let (_, ck, _, we, wa, wd) = m.write.as_ref().unwrap();
        mem_nets.push((format!("$mem:{}:clk", q), vec![*ck]));
        mem_nets.push((format!("$mem:{}:we", q), vec![*we]));
        mem_nets.push((format!("$mem:{}:wa", q), wa.clone()));
        mem_nets.push((format!("$mem:{}:wd", q), wd.clone()));
        for (i, (ra, rd)) in m.reads.iter().enumerate() {
            mem_nets.push((format!("$mem:{}:ra{}", q, i), ra.clone()));
            mem_nets.push((format!("$mem:{}:rd{}", q, i), rd.clone()));
        }
    }
    s.nets.extend(mem_nets);
    let (alias, nets, warnings) = (std::mem::take(&mut s.alias), std::mem::take(&mut s.nets), std::mem::take(&mut s.warnings));
    let pinfo = ports.iter().map(|p| (p.name.clone(), p.dir, p.bits.len())).collect();
    let signals = nets.iter().filter(|(n, _)| !n.starts_with("$mem:")).map(|(n, b)| (n.clone(), b.len())).collect();
    let raw = elaborated(&b, &alias, &ports, &nets, top)?;
    let opt = optimize(b, &alias, ports, nets, top)?;
    Ok(Stages { insts, ports: pinfo, signals, raw, opt, warnings })
}
