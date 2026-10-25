//! Elaboration: walks the veryl-parser syntax tree, flattens the module
//! hierarchy and lowers it into the simulator IR.

use crate::expr::*;
use crate::sim::*;
use crate::value::*;
use std::collections::HashMap;
use veryl_parser::veryl_grammar_trait::*;
use veryl_parser::veryl_walker::VerylWalker;
use veryl_parser::TokenCollector;

type R<T> = Result<T, String>;

/// Collect the source tokens (as text) of any syntax node via the Veryl walker.
fn toks<F: FnOnce(&mut TokenCollector)>(f: F) -> Vec<String> {
    let mut c = TokenCollector::new(false);
    f(&mut c);
    c.tokens.iter().map(|t| t.to_string()).collect()
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Dir { In, Out, Inout }

#[derive(Default, Clone)]
pub struct Scope {
    pub prefix: String,
    pub sigs: HashMap<String, usize>,
    pub params: HashMap<String, Val>,
    pub ports: Vec<(String, Dir, usize)>,
    /// `import Pkg::*` style aliases: local name -> qualified name ("Pkg::Name")
    pub imports: HashMap<String, String>,
}

#[derive(Default, Clone)]
pub struct PkgDef {
    /// enum name -> width
    pub enums: HashMap<String, u32>,
    /// struct name -> fields (name, width, signed)
    pub structs: HashMap<String, Vec<(String, u32, bool)>>,
}

#[derive(Clone)]
pub struct TypeInfo {
    pub w: u32,
    pub signed: bool,
    pub kind: Kind,
    pub two_state: bool,
    pub arr: Option<u32>,
    /// struct fields: (name, bit offset, width)
    pub fields: Vec<(String, u32, u32)>,
}

impl TypeInfo {
    pub fn scalar(w: u32) -> Self {
        TypeInfo { w, signed: false, kind: Kind::Normal, two_state: false, arr: None, fields: vec![] }
    }
}

pub struct Cx { pub reset: Option<(usize, bool)> } // (sig, active-low)

pub struct ModInfo<'a> { pub decl: &'a ModuleDeclaration, pub is_test: bool }

pub struct Elab<'a> {
    pub lib: HashMap<String, ModInfo<'a>>,
    pub pkgs: HashMap<String, PkgDef>,
    /// "Pkg::Enum::Member" -> value
    pub enum_vals: HashMap<String, Val>,
    /// "$tb::reset_gen" instance sig -> its clock sig
    pub tb_clk: HashMap<usize, usize>,
    pub sim: Sim,
    pub procs: Vec<Proc>,
    pub inits: Vec<InitState>,
    pub watched: Vec<usize>,
}

// ---------------- syntax-tree collection helpers ----------------
pub fn collect_modules<'a>(g: &'a DescriptionGroup, out: &mut Vec<(&'a ModuleDeclaration, bool)>) {
    let is_test = g.description_group_list.iter().any(|a| {
        let t = toks(|c| c.attribute(&a.attribute));
        t.iter().skip(1).any(|x| x == "test")
    });
    match &*g.description_group_group {
        DescriptionGroupGroup::DescriptionItem(x) => {
            if let DescriptionItem::DescriptionItemOptPublicDescriptionItem(y) = &*x.description_item {
                if let PublicDescriptionItem::ModuleDeclaration(z) = &*y.public_description_item {
                    out.push((&z.module_declaration, is_test));
                }
            }
        }
        DescriptionGroupGroup::LBraceDescriptionGroupGroupListRBrace(x) => {
            for y in &x.description_group_group_list { collect_modules(&y.description_group, out); }
        }
    }
}

fn module_items<'b>(g: &'b ModuleGroup, out: &mut Vec<&'b GenerateItem>) {
    match &*g.module_group_group {
        ModuleGroupGroup::ModuleItem(x) => out.push(&x.module_item.generate_item),
        ModuleGroupGroup::LBraceModuleGroupGroupListRBrace(x) => {
            for y in &x.module_group_group_list { module_items(&y.module_group, out); }
        }
    }
}

fn collect_gen_items<'b>(b: &'b GenerateNamedBlock, out: &mut Vec<&'b GenerateItem>) {
    for l in &b.generate_named_block_list { gen_group(&l.generate_group, out); }
}

fn gen_group<'b>(g: &'b GenerateGroup, out: &mut Vec<&'b GenerateItem>) {
    match &*g.generate_group_group {
        GenerateGroupGroup::GenerateItem(x) => out.push(&x.generate_item),
        GenerateGroupGroup::LBraceGenerateGroupGroupListRBrace(x) => {
            for y in &x.generate_group_group_list { gen_group(&y.generate_group, out); }
        }
    }
}

/// Collect packages: enums (with member values), structs, consts.
pub fn collect_packages(g: &DescriptionGroup, elab: &mut Elab) {
    let mut decls: Vec<&PackageDeclaration> = vec![];
    fn walk<'x>(dg: &'x DescriptionGroup, out: &mut Vec<&'x PackageDeclaration>) {
        match &*dg.description_group_group {
            DescriptionGroupGroup::DescriptionItem(x) => {
                if let DescriptionItem::DescriptionItemOptPublicDescriptionItem(y) = &*x.description_item {
                    if let PublicDescriptionItem::PackageDeclaration(z) = &*y.public_description_item {
                        out.push(&z.package_declaration);
                    }
                }
            }
            DescriptionGroupGroup::LBraceDescriptionGroupGroupListRBrace(x) => {
                for y in &x.description_group_group_list { walk(&y.description_group, out); }
            }
        }
    }
    walk(g, &mut decls);
    for d in decls {
        let pname = d.identifier.identifier_token.to_string();
        let mut pk = PkgDef::default();
        let mut items: Vec<&PackageItem> = vec![];
        for l in &d.package_declaration_list {
            match &*l.package_group.package_group_group {
                PackageGroupGroup::PackageItem(x) => items.push(&x.package_item),
                PackageGroupGroup::LBracePackageGroupGroupListRBrace(x) => {
                    for y in &x.package_group_group_list {
                        if let PackageGroupGroup::PackageItem(z) = &*y.package_group.package_group_group {
                            items.push(&z.package_item);
                        }
                    }
                }
            }
        }
        // package consts: "Pkg::NAME" (stored with the enum members)
        for it in &items {
            if let PackageItem::ConstDeclaration(x) = it {
                let c = &x.const_declaration;
                let t = toks(|k| k.expression(&c.expression));
                if let Ok(v) = elab.const_in(&Scope::default(), &t) {
                    elab.enum_vals.insert(format!("{}::{}", pname, c.identifier.identifier_token), v);
                }
            }
        }
        // enums first (members may be referenced by other items)
        for it in &items {
            if let PackageItem::EnumDeclaration(x) = it {
                let e = &x.enum_declaration;
                let ename = e.identifier.identifier_token.to_string();
                let w = match &e.enum_declaration_opt {
                    Some(o) => {
                        let t = toks(|c| c.scalar_type(&o.scalar_type));
                        match elab.parse_type(&Scope::default(), &t) { Ok(ty) => ty.w, Err(_) => 32 }
                    }
                    None => 32,
                };
                pk.enums.insert(ename.clone(), w);
                // member values
                let mut members: Vec<(&EnumItem, Option<&Expression>)> = vec![];
                fn enum_group<'x>(g: &'x EnumGroup, out: &mut Vec<(&'x EnumItem, Option<&'x Expression>)>) {
                    match &*g.enum_group_group {
                        EnumGroupGroup::EnumItem(x) => {
                            let ei = &x.enum_item;
                            out.push((ei, ei.enum_item_opt.as_ref().map(|o| &*o.expression)));
                        }
                        EnumGroupGroup::LBraceEnumListRBrace(x) => {
                            enum_group(&x.enum_list.enum_group, out);
                            for y in &x.enum_list.enum_list_list { enum_group(&y.enum_group, out); }
                        }
                    }
                }
                enum_group(&e.enum_list.enum_group, &mut members);
                for y in &e.enum_list.enum_list_list { enum_group(&y.enum_group, &mut members); }
                let mut next = 0u128;
                for (ei, mex) in members {
                    let mname = ei.identifier.identifier_token.to_string();
                    let v = match mex {
                        Some(x) => {
                            let t = toks(|c| c.expression(x));
                            elab.const_in(&Scope::default(), &t).unwrap_or(Val::new(32, 0)).v
                        }
                        None => next,
                    };
                    next = v + 1;
                    elab.enum_vals.insert(format!("{}::{}::{}", pname, ename, mname), Val::new(w, v));
                }
            }
        }
        // structs
        for it in &items {
            if let PackageItem::StructUnionDeclaration(x) = it {
                let s = &x.struct_union_declaration;
                if !toks(|c| c.struct_union(&s.struct_union)).join("").contains("struct") { continue; }
                let sname = s.identifier.identifier_token.to_string();
                let mut fields: Vec<(String, u32, bool)> = vec![];
                fn struct_group<'x>(g: &'x StructUnionGroup, elab: &Elab, out: &mut Vec<(String, u32, bool)>) {
                    match &*g.struct_union_group_group {
                        StructUnionGroupGroup::StructUnionItem(x) => {
                            let si = &x.struct_union_item;
                            let fname = si.identifier.identifier_token.to_string();
                            let t = toks(|c| c.scalar_type(&si.scalar_type));
                            if let Ok(ty) = elab.parse_type(&Scope::default(), &t) { out.push((fname, ty.w, ty.signed)); }
                        }
                        StructUnionGroupGroup::LBraceStructUnionListRBrace(x) => {
                            struct_group(&x.struct_union_list.struct_union_group, elab, out);
                            for y in &x.struct_union_list.struct_union_list_list { struct_group(&y.struct_union_group, elab, out); }
                        }
                    }
                }
                struct_group(&s.struct_union_list.struct_union_group, elab, &mut fields);
                for y in &s.struct_union_list.struct_union_list_list { struct_group(&y.struct_union_group, elab, &mut fields); }
                pk.structs.insert(sname, fields);
            }
        }
        elab.pkgs.insert(pname, pk);
    }
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
            out.push((
                it.identifier.identifier_token.to_string(),
                it.inst_parameter_item_opt.as_ref().map(|o| toks(|c| c.expression(&o.expression))),
            ));
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
            out.push((
                it.identifier.identifier_token.to_string(),
                it.inst_port_item_opt.as_ref().map(|o| toks(|c| c.expression(&o.expression))),
            ));
        }
        InstPortGroupGroup::LBraceInstPortListRBrace(x) => ipo_list(&x.inst_port_list, out),
    }
}

fn call_args(f: &FunctionCall) -> Vec<Vec<String>> {
    let mut v = vec![];
    if let Some(o) = &f.function_call_opt {
        let l = &o.argument_list;
        v.push(toks(|c| c.expression(&l.argument_item.argument_expression.expression)));
        for x in &l.argument_list_list {
            v.push(toks(|c| c.expression(&x.argument_item.argument_expression.expression)));
        }
    }
    v
}

impl<'a> Elab<'a> {
    pub fn new(lib: HashMap<String, ModInfo<'a>>) -> Self {
        Elab { lib, pkgs: HashMap::new(), enum_vals: HashMap::new(), tb_clk: HashMap::new(), sim: Sim::new(), procs: vec![], inits: vec![], watched: vec![] }
    }

    // ---------------- scope helpers ----------------
    fn resolve_path(&self, sc: &Scope, path: &[String]) -> Option<Res> {
        if path.is_empty() { return None; }
        let name = &path[0];
        // single identifier: param / signal / import
        if path.len() == 1 {
            if let Some(v) = sc.params.get(name) { return Some(Res::Const(*v)); }
            if let Some(i) = sc.sigs.get(name) {
                return Some(if self.sim.sigs[*i].arr.is_some() { Res::Arr(*i) } else { Res::Sig(*i) });
            }
            // function name?
            if self.sim.funcs.contains_key(name) { return Some(Res::Fn(name.clone())); }
            // imported name -> qualified member/type
            if let Some(q) = sc.imports.get(name) {
                if let Some(v) = self.enum_vals.get(q) { return Some(Res::Const(*v)); }
                if let Some((pkg, ty)) = q.split_once("::") {
                    let p = &self.pkgs[pkg];
                    if p.enums.contains_key(ty) {
                        // type used as expression: not valid; fall through
                    }
                }
            }
            return None;
        }
        if path.len() >= 2 {
            let pkg = &path[0];
            let joined = path.join("::");
            if let Some(v) = self.enum_vals.get(&joined) { return Some(Res::Const(*v)); }
            if path.len() == 2 {
                if let Some(p) = self.pkgs.get(pkg) {
                    let ty = &path[1];
                    if p.enums.contains_key(ty) || p.structs.contains_key(ty) {
                        return Some(Res::Const(Val::new(32, 0))); // type name in expression: unused
                    }
                }
            }
            // imported short name: AluOp::Add -> Pkg::AluOp::Add
            if let Some(q) = sc.imports.get(name) {
                let full = format!("{}::{}", q, path[1..].join("::"));
                if let Some(v) = self.enum_vals.get(&full) { return Some(Res::Const(*v)); }
            }
        }
        None
    }

    fn field_of(&self, sig: usize, name: &str) -> Option<(u32, u32)> {
        self.sim.sigs.get(sig)?.fields.iter().find(|(n, _, _)| n == name).map(|(_, lo, w)| (*lo, *w))
    }

    fn parse_in(&self, sc: &Scope, t: &[String]) -> R<Expr> {
        parse_expr(t, &|path| self.resolve_path(sc, path), &|sig, f| self.field_of(sig, f))
    }

    fn const_in(&self, sc: &Scope, t: &[String]) -> R<Val> {
        let e = self.parse_in(sc, t)?;
        // evaluate with a fresh kernel: user functions are not available here,
        // but constant expressions never call them
        let mut tmp = Sim::new();
        Ok(tmp.eval(&e, 0))
    }

    /// const expression used inside `parse_type`, where no Scope is available
    fn const_eval(e: &Expr) -> Val {
        let mut tmp = Sim::new();
        tmp.eval(e, 0)
    }

    fn declare(&mut self, sc: &mut Scope, name: &str, ty: &TypeInfo) -> usize {
        // array: declare `n` contiguous element signals; map name -> element 0
        if let Some(n) = ty.arr {
            let elem = TypeInfo { arr: None, ..(*ty).clone() };
            let mut first = None;
            for k in 0..n {
                let full = if sc.prefix.is_empty() { format!("{}[{}]", name, k) } else { format!("{}.{}[{}]", sc.prefix, name, k) };
                let val = if elem.two_state { Val::new(elem.w, 0) } else { Val::allx(elem.w) }.signed(elem.signed);
                let id = self.sim.sigs.len();
                self.sim.sigs.push(Signal { name: full, w: elem.w, signed: elem.signed, kind: elem.kind.clone(), val, arr: None, fields: elem.fields.clone() });
                if first.is_none() { first = Some(id); }
            }
            let f = first.unwrap();
            self.sim.sigs[f].arr = Some(n);
            sc.sigs.insert(name.to_string(), f);
            return f;
        }
        let full = if sc.prefix.is_empty() { name.to_string() } else { format!("{}.{}", sc.prefix, name) };
        let val = if ty.two_state { Val::new(ty.w, 0) } else { Val::allx(ty.w) }.signed(ty.signed);
        let id = self.sim.sigs.len();
        self.sim.sigs.push(Signal { name: full, w: ty.w, signed: ty.signed, kind: ty.kind.clone(), val, arr: None, fields: ty.fields.clone() });
        sc.sigs.insert(name.to_string(), id);
        id
    }

    /// Parse a type from its tokens: logic<8>, bit, u32, clock, reset,
    /// Pkg::Enum, Pkg::Struct, ... optionally followed by an array size [N].
    fn parse_type(&self, sc: &Scope, t: &[String]) -> R<TypeInfo> {
        let mut i = 0;
        let mut signed = false;
        while i < t.len() && matches!(t[i].as_str(), "tri" | "signed" | "default") {
            if t[i] == "signed" { signed = true; }
            i += 1;
        }
        let head = t.get(i).ok_or("missing type")?.as_str();
        let mut info = TypeInfo::scalar(1);
        info.signed = signed;
        match head {
            "logic" | "bit" => {
                info.two_state = head == "bit";
                if t.get(i + 1).map(|s| s.as_str()) == Some("<") {
                    let r = |n: &str| -> Option<Res> {
                        if let Some(v) = sc.params.get(n) { return Some(Res::Const(*v)); }
                        sc.sigs.get(n).map(|k| Res::Sig(*k))
                    };
                    let r2 = |path: &[String]| -> Option<Res> { r(&path[0]) };
                    let mut p = P { t, i: i + 2, r: &r2, f: &|_, _| None };
                    let mut w = 1u128;
                    loop {
                        let e = p.expr()?;
                        w *= Self::const_eval(&e).v.max(1);
                        match p.peek() { Some(",") => p.i += 1, _ => break }
                    }
                    info.w = w.clamp(1, 128) as u32;
                    i = p.i + if p.peek() == Some(">") { 1 } else { 0 };
                } else { i += 1; }
            }
            "clock" | "clock_posedge" => { info.kind = Kind::Clock(true); i += 1; }
            "clock_negedge" => { info.kind = Kind::Clock(false); i += 1; }
            "reset" | "reset_async_low" => { info.kind = Kind::Reset { low: true, asynch: true }; i += 1; }
            "reset_async_high" => { info.kind = Kind::Reset { low: false, asynch: true }; i += 1; }
            "reset_sync_low" => { info.kind = Kind::Reset { low: true, asynch: false }; i += 1; }
            "reset_sync_high" => { info.kind = Kind::Reset { low: false, asynch: false }; i += 1; }
            "bool" => { info.two_state = true; i += 1; }
            h if h.len() > 1 && matches!(h.as_bytes()[0], b'u' | b'i' | b'p') && h[1..].parse::<u32>().is_ok() => {
                info.w = h[1..].parse().unwrap();
                info.signed = h.starts_with('i');
                info.two_state = true;
                i += 1;
            }
            other => {
                // user-defined type: Pkg::Name or imported Name
                let qualified = if t.get(i + 1).map(|s| s.as_str()) == Some("::") {
                    format!("{}::{}", other, t[i + 2])
                } else if let Some(q) = sc.imports.get(other) {
                    q.clone()
                } else {
                    return Err(format!("unsupported type '{}'", other));
                };
                let Some((pkg, ty)) = qualified.split_once("::") else {
                    return Err(format!("unsupported type '{}'", qualified));
                };
                let p = self.pkgs.get(pkg).ok_or(format!("unknown package '{}'", pkg))?;
                if let Some(w) = p.enums.get(ty) {
                    info.w = *w;
                    info.two_state = true;
                    i += if t.get(i + 1).map(|s| s.as_str()) == Some("::") { 3 } else { 1 };
                } else if let Some(fields) = p.structs.get(ty) {
                    // packed struct: the first field is the most significant (as in SystemVerilog)
                    let w: u32 = fields.iter().map(|f| f.1).sum();
                    let (mut hi, mut offs) = (w, vec![]);
                    for (fname, fw, _fs) in fields {
                        hi -= fw;
                        offs.push((fname.clone(), hi, *fw));
                    }
                    info.w = w;
                    info.fields = offs;
                    info.two_state = true;
                    i += if t.get(i + 1).map(|s| s.as_str()) == Some("::") { 3 } else { 1 };
                } else {
                    return Err(format!("unknown type '{}'", qualified));
                }
            }
        }
        // array dimension
        if t.get(i).map(|s| s.as_str()) == Some("[") {
            let r = |n: &str| -> Option<Res> {
                if let Some(v) = sc.params.get(n) { return Some(Res::Const(*v)); }
                sc.sigs.get(n).map(|k| Res::Sig(*k))
            };
            let r2 = |path: &[String]| -> Option<Res> { r(&path[0]) };
            let mut p = P { t, i: i + 1, r: &r2, f: &|_, _| None };
            let cnt = p.expr()?;
            if p.peek() != Some("]") { return Err("expected ']' in array type".into()); }
            info.arr = Some(Self::const_eval(&cnt).v as u32);
        }
        Ok(info)
    }

    // ---------------- module elaboration ----------------
    pub fn elab_module(&mut self, m: &'a ModuleDeclaration, prefix: &str, ov: &HashMap<String, Val>) -> R<Scope> {
        let mut sc = Scope { prefix: prefix.to_string(), ..Default::default() };

        // parameters
        if let Some(wp) = &m.module_declaration_opt1 {
            let mut items = vec![];
            if let Some(o) = &wp.with_parameter.with_parameter_opt { wp_list(&o.with_parameter_list, &mut items); }
            for it in items {
                let name = it.identifier.identifier_token.to_string();
                let ty = match &*it.with_parameter_item_group0 {
                    WithParameterItemGroup0::ArrayType(a) => {
                        let t = toks(|c| c.array_type(&a.array_type));
                        self.parse_type(&sc, &t).ok()
                    }
                    _ => None,
                };
                let mut val = if let Some(v) = ov.get(&name) { *v } else if let Some(o) = &it.with_parameter_item_opt {
                    let t = toks(|c| c.expression(&o.expression));
                    self.const_in(&sc, &t)?
                } else { return Err(format!("parameter '{}' has no value", name)) };
                if let Some(ty) = ty { val = val.resize(ty.w).signed(ty.signed); }
                sc.params.insert(name, val);
            }
        }

        // ports
        let mut port_items = vec![];
        if let Some(pd) = &m.module_declaration_opt2 {
            if let Some(o) = &pd.port_declaration.port_declaration_opt { pd_list(&o.port_declaration_list, &mut port_items); }
        }
        for it in port_items {
            let name = it.identifier.identifier_token.to_string();
            let PortDeclarationItemGroup::PortTypeConcrete(pt) = &*it.port_declaration_item_group else {
                return Err(format!("port '{}': interface/modport ports are not supported", name));
            };
            let pt = &pt.port_type_concrete;
            let dir = match &*pt.direction {
                Direction::Input(_) => Dir::In,
                Direction::Output(_) => Dir::Out,
                Direction::Inout(_) => Dir::Inout,
                _ => return Err(format!("port '{}': unsupported direction", name)),
            };
            let t = toks(|c| c.array_type(&pt.array_type));
            let ty = self.parse_type(&sc, &t).map_err(|e| format!("port '{}': {}", name, e))?;
            let id = self.declare(&mut sc, &name, &ty);
            sc.ports.push((name, dir, id));
        }

        let mut items = vec![];
        for l in &m.module_declaration_list { module_items(&l.module_group, &mut items); }

        // pass 1: declarations that other items may refer to
        for it in &items { self.pass1(&mut sc, it)?; }

        // pass 2: behaviour
        let cx = Cx { reset: None };
        for it in &items { self.pass2(&mut sc, it, &cx)?; }
        Ok(sc)
    }

    fn pass1(&mut self, sc: &mut Scope, it: &GenerateItem) -> R<()> {
        match it {
            GenerateItem::VarDeclaration(x) => self.decl_var(sc, &x.var_declaration)?,
            GenerateItem::ConstDeclaration(x) => self.decl_const(sc, &x.const_declaration)?,
            GenerateItem::LetDeclaration(x) => {
                let l = &x.let_declaration;
                if let Some(o) = &l.let_declaration_opt {
                    let t = toks(|c| c.array_type(&o.array_type));
                    let ty = self.parse_type(sc, &t)?;
                    self.declare(sc, &l.identifier.identifier_token.to_string(), &ty);
                }
            }
            GenerateItem::ImportDeclaration(x) => {
                let d = &x.import_declaration;
                let pkg = toks(|c| c.scoped_identifier(&d.scoped_identifier)).join("");
                let names: Vec<String> = match &d.import_declaration_opt {
                    None => vec![],
                    Some(o) => match &*o.import_declaration_opt_group {
                        ImportDeclarationOptGroup::Star(_) => {
                            let mut v: Vec<String> = self.pkgs.get(&pkg).map(|p| {
                                p.enums.keys().chain(p.structs.keys()).cloned().collect()
                            }).unwrap_or_default();
                            // package consts ("Pkg::NAME", no further "::")
                            let pre = format!("{}::", pkg);
                            v.extend(self.enum_vals.keys().filter_map(|k| k.strip_prefix(&pre)).filter(|k| !k.contains("::")).map(|k| k.to_string()));
                            v
                        }
                        ImportDeclarationOptGroup::MultipleImportList(l) => {
                            let ml = &l.multiple_import_list;
                            let mut v = vec![ml.multiple_import_item.identifier.identifier_token.to_string()];
                            for y in &ml.multiple_import_list_list {
                                v.push(y.multiple_import_item.identifier.identifier_token.to_string());
                            }
                            v
                        }
                    },
                };
                for n in names { sc.imports.insert(n.clone(), format!("{}::{}", pkg, n)); }
            }
            GenerateItem::InstDeclaration(x) => {
                let ci = &x.inst_declaration.component_instantiation;
                let kind = toks(|c| c.scoped_identifier(&ci.scoped_identifier)).join("");
                let name = ci.identifier.identifier_token.to_string();
                match kind.as_str() {
                    "$tb::clock_gen" => {
                        let mut half = 5;
                        if let Some(p) = &ci.component_instantiation_opt1 {
                            let mut v = vec![];
                            if let Some(o) = &p.inst_parameter.inst_parameter_opt { ip_list(&o.inst_parameter_list, &mut v); }
                            for (n, e) in v {
                                if n == "PERIOD" { if let Some(e) = e { half = (self.const_in(sc, &e)?.v as u64 / 2).max(1); } }
                            }
                        }
                        let ty = TypeInfo::scalar(1);
                        let id = self.declare(sc, &name, &TypeInfo { kind: Kind::Clock(true), two_state: true, ..ty });
                        self.procs.push(Proc::ClockGen { sig: id, half });
                    }
                    "$tb::reset_gen" => {
                        let ty = TypeInfo::scalar(1);
                        let id = self.declare(sc, &name, &TypeInfo { kind: Kind::Reset { low: true, asynch: true }, two_state: true, ..ty });
                        self.sim.sigs[id].val = Val::new(1, 1);
                        // `inst rst: $tb::reset_gen(clk);` — remember the clock
                        let mut conns: NamedToks = vec![];
                        if let Some(p) = &ci.component_instantiation_opt2 {
                            if let Some(o) = &p.inst_port.inst_port_opt { ipo_list(&o.inst_port_list, &mut conns); }
                        }
                        if let Some((_, first)) = conns.first() {
                            let t = first.clone().unwrap_or_else(|| vec![conns[0].0.clone()]);
                            if let Some(c) = sc.sigs.get(&t[0]) { self.tb_clk.insert(id, *c); }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn pass2(&mut self, sc: &mut Scope, it: &'a GenerateItem, cx: &Cx) -> R<()> {
        match it {
            GenerateItem::LetDeclaration(x) => {
                let l = &x.let_declaration;
                let name = l.identifier.identifier_token.to_string();
                let t = toks(|c| c.expression(&l.expression));
                let e = self.parse_in(sc, &t)?;
                if !sc.sigs.contains_key(&name) {
                    let w = self.sim.eval(&e, 0).w;
                    self.declare(sc, &name, &TypeInfo::scalar(w));
                }
                let id = sc.sigs[&name];
                self.procs.push(Proc::Comb(vec![Stmt::Assign(LValue { sig: id, sel: Sel::All }, e)]));
            }
            GenerateItem::AssignDeclaration(x) => {
                let a = &x.assign_declaration;
                let AssignDestination::HierarchicalIdentifier(h) = &*a.assign_destination else {
                    return Err("concatenation as assign destination is not supported".into());
                };
                let lt = toks(|c| c.hierarchical_identifier(&h.hierarchical_identifier));
                let lv = to_lvalue(&self.parse_in(sc, &lt)?)?;
                let rt = toks(|c| c.expression(&a.expression));
                let e = self.parse_in(sc, &rt)?;
                self.procs.push(Proc::Comb(vec![Stmt::Assign(lv, e)]));
            }
            GenerateItem::AlwaysCombDeclaration(x) => {
                let body = self.lower_block(sc, &x.always_comb_declaration.statement_block, &Cx { reset: None })?;
                self.procs.push(Proc::Comb(body));
            }
            GenerateItem::AlwaysFfDeclaration(x) => self.always_ff(sc, &x.always_ff_declaration)?,
            GenerateItem::InitialDeclaration(x) => {
                let body = self.lower_block(sc, &x.initial_declaration.statement_block, cx)?;
                let mut st = InitState::default();
                compile_initial(&body, &mut st.ops, &mut self.watched);
                self.inits.push(st);
            }
            GenerateItem::FunctionDeclaration(x) => self.decl_function(sc, &x.function_declaration)?,
            GenerateItem::GenerateForDeclaration(x) => self.gen_for(sc, &x.generate_for_declaration, cx)?,
            GenerateItem::GenerateIfDeclaration(x) => self.gen_if(sc, &x.generate_if_declaration, cx)?,
            GenerateItem::GenerateBlockDeclaration(x) => {
                let mut items = vec![];
                collect_gen_items(&x.generate_block_declaration.generate_named_block, &mut items);
                self.gen_items(sc, &items, cx)?;
            }
            GenerateItem::InstDeclaration(x) => self.instantiate(sc, &x.inst_declaration)?,
            GenerateItem::VarDeclaration(_) | GenerateItem::ConstDeclaration(_) => {}
            GenerateItem::FinalDeclaration(_) => {}
            GenerateItem::ImportDeclaration(_) => {}
            _ => return Err("unsupported module item".into()),
        }
        Ok(())
    }

    fn decl_function(&mut self, sc: &mut Scope, f: &'a FunctionDeclaration) -> R<()> {
        let name = f.identifier.identifier_token.to_string();
        let mut fsc = Scope { prefix: format!("{}[fn:{}]", sc.prefix, name), ..Default::default() };
        let mut params = vec![];
        if let Some(o) = &f.function_declaration_opt0 {
            let mut port_items = vec![];
            if let Some(p) = &o.port_declaration.port_declaration_opt { pd_list(&p.port_declaration_list, &mut port_items); }
            for it in port_items {
                let pname = it.identifier.identifier_token.to_string();
                let PortDeclarationItemGroup::PortTypeConcrete(pt) = &*it.port_declaration_item_group else {
                    return Err(format!("function '{}': interface ports are not supported", name));
                };
                let t = toks(|c| c.array_type(&pt.port_type_concrete.array_type));
                let ty = self.parse_type(sc, &t)?;
                let id = self.declare(&mut fsc, &pname, &ty);
                params.push(id);
            }
        }
        let ret = if let Some(o) = &f.function_declaration_opt1 {
            let t = toks(|c| c.scalar_type(&o.scalar_type));
            let ty = self.parse_type(sc, &t)?;
            Some(self.declare(&mut fsc, "$ret", &ty))
        } else { None };
        let body = self.lower_block(&mut fsc, &f.statement_block, &Cx { reset: None })?;
        self.sim.funcs.insert(name, FuncDef { params, ret, body });
        Ok(())
    }

    fn gen_for(&mut self, sc: &mut Scope, g: &'a GenerateForDeclaration, cx: &Cx) -> R<()> {
        if g.generate_for_declaration_opt.is_some() { return Err("`for ... in rev` generate is not supported".into()); }
        if g.generate_for_declaration_opt0.is_some() { return Err("generate `step` is not supported".into()); }
        let var = g.identifier.identifier_token.to_string();
        let from = Self::const_eval(&self.parse_in(sc, &toks(|k| k.expression(&g.range.expression)))?);
        let o = g.range.range_opt.as_ref().ok_or("generate for needs `a..b`")?;
        let to = Self::const_eval(&self.parse_in(sc, &toks(|k| k.expression(&o.expression)))?);
        let incl = toks(|k| k.range_operator(&o.range_operator)).join("") == "..=";
        let mut items = vec![];
        collect_gen_items(&g.generate_named_block, &mut items);
        let n_before = self.sim.sigs.len();
        let mut i = from.v;
        loop {
            let hit_end = if incl { i > to.v } else { i >= to.v };
            if hit_end { break; }
            let mut inner = Scope { prefix: sc.prefix.clone(), sigs: sc.sigs.clone(), params: sc.params.clone(), ports: vec![], imports: sc.imports.clone() };
            inner.params.insert(var.clone(), Val::new(32, i));
            for it in &items { self.pass1(&mut inner, it)?; }
            for it in &items { self.pass2(&mut inner, it, cx)?; }
            // merge any newly declared signals back
            for (k, v) in &inner.sigs { sc.sigs.entry(k.clone()).or_insert(*v); }
            i += 1;
        }
        let _ = n_before;
        Ok(())
    }

    /// `if C : label { .. } else if .. else { .. }` with constant conditions
    fn gen_if(&mut self, sc: &mut Scope, g: &'a GenerateIfDeclaration, cx: &Cx) -> R<()> {
        let truth = |s: &Self, e: &Expression| -> R<bool> {
            Ok(Self::const_eval(&s.parse_in(sc, &toks(|k| k.expression(e)))?).v != 0)
        };
        let mut items = vec![];
        if truth(self, &g.expression)? {
            collect_gen_items(&g.generate_named_block, &mut items);
        } else if let Some(e) = g.generate_if_declaration_list.iter().find_map(|e| match truth(self, &e.expression) {
            Ok(true) => Some(Ok(e)),
            Ok(false) => None,
            Err(m) => Some(Err(m)),
        }) {
            for l in &e?.generate_optional_named_block.generate_optional_named_block_list { gen_group(&l.generate_group, &mut items); }
        } else if let Some(o) = &g.generate_if_declaration_opt {
            for l in &o.generate_optional_named_block.generate_optional_named_block_list { gen_group(&l.generate_group, &mut items); }
        }
        self.gen_items(sc, &items, cx)
    }

    /// elaborate generate-block items in a child scope; new signals stay visible
    fn gen_items(&mut self, sc: &mut Scope, items: &[&'a GenerateItem], cx: &Cx) -> R<()> {
        let mut inner = Scope { prefix: sc.prefix.clone(), sigs: sc.sigs.clone(), params: sc.params.clone(), ports: vec![], imports: sc.imports.clone() };
        for it in items { self.pass1(&mut inner, it)?; }
        for it in items { self.pass2(&mut inner, it, cx)?; }
        for (k, v) in &inner.sigs { sc.sigs.entry(k.clone()).or_insert(*v); }
        Ok(())
    }

    fn decl_var(&mut self, sc: &mut Scope, v: &VarDeclaration) -> R<()> {
        let name = v.identifier.identifier_token.to_string();
        let o = v.var_declaration_opt.as_ref().ok_or(format!("var '{}' needs a type", name))?;
        let t = toks(|c| c.array_type(&o.array_type));
        let ty = self.parse_type(sc, &t).map_err(|e| format!("var '{}': {}", name, e))?;
        self.declare(sc, &name, &ty);
        Ok(())
    }

    fn decl_const(&mut self, sc: &mut Scope, c: &ConstDeclaration) -> R<()> {
        let name = c.identifier.identifier_token.to_string();
        let t = toks(|k| k.expression(&c.expression));
        let mut v = self.const_in(sc, &t)?;
        if let Some(o) = &c.const_declaration_opt {
            if let ConstDeclarationOptGroup::ArrayType(a) = &*o.const_declaration_opt_group {
                let tt = toks(|k| k.array_type(&a.array_type));
                if let Ok(ty) = self.parse_type(sc, &tt) { v = v.resize(ty.w).signed(ty.signed); }
            }
        }
        sc.params.insert(name, v);
        Ok(())
    }

    fn always_ff(&mut self, sc: &mut Scope, a: &AlwaysFfDeclaration) -> R<()> {
        let find_sig = |sc: &Scope, pred: &dyn Fn(Kind) -> bool| -> Option<usize> {
            let mut c: Vec<usize> = sc.sigs.values().copied().filter(|i| pred(self.sim.sigs[*i].kind)).collect();
            c.sort();
            c.first().copied()
        };
        let mut clk = None;
        let mut rst = None;
        if let Some(o) = &a.always_ff_declaration_opt {
            let ev = &o.always_ff_event_list;
            let t = toks(|c| c.hierarchical_identifier(&ev.always_ff_clock.hierarchical_identifier));
            clk = Some(*sc.sigs.get(&t[0]).ok_or(format!("unknown clock '{}'", t[0]))?);
            if let Some(r) = &ev.always_ff_event_list_opt {
                let t = toks(|c| c.hierarchical_identifier(&r.always_ff_reset.hierarchical_identifier));
                rst = Some(*sc.sigs.get(&t[0]).ok_or(format!("unknown reset '{}'", t[0]))?);
            }
        }
        let clk = match clk {
            Some(c) => c,
            None => find_sig(sc, &|k| matches!(k, Kind::Clock(_))).ok_or("always_ff: no clock found")?,
        };
        let uses_reset = rst.is_some() || {
            // does the body contain if_reset? peek at the token stream
            toks(|c| c.statement_block(&a.statement_block)).iter().any(|t| t == "if_reset")
        };
        if rst.is_none() && uses_reset {
            rst = find_sig(sc, &|k| matches!(k, Kind::Reset { .. }));
        }
        let rinfo = rst.map(|r| match self.sim.sigs[r].kind {
            Kind::Reset { low, asynch } => (r, low, asynch),
            _ => (r, true, false),
        });
        let pos = !matches!(self.sim.sigs[clk].kind, Kind::Clock(false));
        let cx = Cx { reset: rinfo.map(|(r, low, _)| (r, low)) };
        let body = self.lower_block(sc, &a.statement_block, &cx)?;
        self.watched.push(clk);
        if let Some((r, _, true)) = rinfo { self.watched.push(r); }
        self.procs.push(Proc::Ff { clk, pos, rst: rinfo, body });
        Ok(())
    }

    fn instantiate(&mut self, sc: &mut Scope, d: &InstDeclaration) -> R<()> {
        let ci = &d.component_instantiation;
        let iname = ci.identifier.identifier_token.to_string();
        let kind = toks(|c| c.scoped_identifier(&ci.scoped_identifier)).join("");
        if kind.starts_with("$tb::") { return Ok(()); }
        let child = self.lib.get(&kind).ok_or(format!("unknown module '{}'", kind))?.decl;

        let mut ov = HashMap::new();
        if let Some(p) = &ci.component_instantiation_opt1 {
            let mut v = vec![];
            if let Some(o) = &p.inst_parameter.inst_parameter_opt { ip_list(&o.inst_parameter_list, &mut v); }
            for (n, e) in v {
                let val = match e {
                    Some(t) => self.const_in(sc, &t)?,
                    None => *sc.params.get(&n).ok_or(format!("parameter '{}' not found", n))?,
                };
                ov.insert(n, val);
            }
        }
        let mut conns: NamedToks = vec![];
        if let Some(p) = &ci.component_instantiation_opt2 {
            if let Some(o) = &p.inst_port.inst_port_opt { ipo_list(&o.inst_port_list, &mut conns); }
        }
        let prefix = if sc.prefix.is_empty() { iname.clone() } else { format!("{}.{}", sc.prefix, iname) };
        let csc = self.elab_module(child, &prefix, &ov)?;
        for (pname, dir, psig) in &csc.ports {
            let Some((_, expr)) = conns.iter().find(|(n, _)| n == pname) else { continue };
            let t = expr.clone().unwrap_or_else(|| vec![pname.clone()]);
            let e = self.parse_in(sc, &t)?;
            match dir {
                Dir::In => self.procs.push(Proc::Comb(vec![Stmt::Assign(LValue { sig: *psig, sel: Sel::All }, e)])),
                Dir::Out => {
                    let lv = to_lvalue(&e).map_err(|m| format!("{}.{}: output must connect to a signal ({})", iname, pname, m))?;
                    self.procs.push(Proc::Comb(vec![Stmt::Assign(lv, Expr::Sig(*psig))]));
                }
                Dir::Inout => return Err("inout ports are not supported".into()),
            }
        }
        Ok(())
    }

    // ---------------- statements ----------------
    fn lower_block(&mut self, sc: &mut Scope, b: &StatementBlock, cx: &Cx) -> R<Vec<Stmt>> {
        let mut out = vec![];
        for l in &b.statement_block_list { self.lower_group(sc, &l.statement_block_group, cx, &mut out)?; }
        Ok(out)
    }

    fn lower_group(&mut self, sc: &mut Scope, g: &StatementBlockGroup, cx: &Cx, out: &mut Vec<Stmt>) -> R<()> {
        match &*g.statement_block_group_group {
            StatementBlockGroupGroup::StatementBlockItem(x) => self.lower_item(sc, &x.statement_block_item, cx, out),
            StatementBlockGroupGroup::BlockLBraceStatementBlockGroupGroupListRBrace(x) => {
                for y in &x.statement_block_group_group_list { self.lower_group(sc, &y.statement_block_group, cx, out)?; }
                Ok(())
            }
        }
    }

    fn lower_item(&mut self, sc: &mut Scope, it: &StatementBlockItem, cx: &Cx, out: &mut Vec<Stmt>) -> R<()> {
        match it {
            StatementBlockItem::VarDeclaration(x) => self.decl_var(sc, &x.var_declaration),
            StatementBlockItem::ConstDeclaration(x) => self.decl_const(sc, &x.const_declaration),
            StatementBlockItem::LetStatement(x) => {
                let l = &x.let_statement;
                let name = l.identifier.identifier_token.to_string();
                let t = toks(|c| c.expression(&l.expression));
                let e = self.parse_in(sc, &t)?;
                if let Some(o) = &l.let_statement_opt {
                    let tt = toks(|c| c.array_type(&o.array_type));
                    let ty = self.parse_type(sc, &tt)?;
                    self.declare(sc, &name, &ty);
                } else {
                    let w = self.sim.eval(&e, 0).w;
                    self.declare(sc, &name, &TypeInfo::scalar(w));
                }
                out.push(Stmt::Assign(LValue { sig: sc.sigs[&name], sel: Sel::All }, e));
                Ok(())
            }
            StatementBlockItem::Statement(x) => self.lower_stmt(sc, &x.statement, cx, out),
            _ => Err("unsupported statement kind (generate / concatenation assignment)".into()),
        }
    }

    fn sub(&mut self, sc: &mut Scope, b: &StatementBlock, cx: &Cx) -> R<Vec<Stmt>> { self.lower_block(sc, b, cx) }

    fn lower_stmt(&mut self, sc: &mut Scope, s: &Statement, cx: &Cx, out: &mut Vec<Stmt>) -> R<()> {
        match s {
            Statement::IdentifierStatement(x) => self.lower_ident_stmt(sc, &x.identifier_statement, out),
            Statement::IfStatement(x) => {
                let i = &x.if_statement;
                let mut arms = vec![];
                let c = self.parse_in(sc, &toks(|c| c.expression(&i.expression)))?;
                arms.push((c, self.sub(sc, &i.statement_block, cx)?));
                for e in &i.if_statement_list {
                    let c = self.parse_in(sc, &toks(|c| c.expression(&e.expression)))?;
                    arms.push((c, self.sub(sc, &e.statement_block, cx)?));
                }
                let els = match &i.if_statement_opt { Some(o) => self.sub(sc, &o.statement_block, cx)?, None => vec![] };
                out.push(Stmt::If(arms, els));
                Ok(())
            }
            Statement::IfResetStatement(x) => {
                let i = &x.if_reset_statement;
                let (r, low) = cx.reset.ok_or("if_reset used without a reset signal")?;
                let active = Expr::Bin("==".into(), Box::new(Expr::Sig(r)), Box::new(Expr::Num(Val::new(1, if low { 0 } else { 1 }))));
                let mut arms = vec![(active, self.sub(sc, &i.statement_block, cx)?)];
                for e in &i.if_reset_statement_list {
                    let c = self.parse_in(sc, &toks(|c| c.expression(&e.expression)))?;
                    arms.push((c, self.sub(sc, &e.statement_block, cx)?));
                }
                let els = match &i.if_reset_statement_opt { Some(o) => self.sub(sc, &o.statement_block, cx)?, None => vec![] };
                out.push(Stmt::If(arms, els));
                Ok(())
            }
            Statement::CaseStatement(x) => {
                let c = &x.case_statement;
                let sel = self.parse_in(sc, &toks(|k| k.expression(&c.expression)))?;
                let (mut arms, mut def) = (vec![], vec![]);
                for it in &c.case_statement_list {
                    let ci = &it.case_item;
                    let body = match &*ci.case_item_group0 {
                        CaseItemGroup0::Statement(s) => { let mut v = vec![]; self.lower_stmt(sc, &s.statement, cx, &mut v)?; v }
                        CaseItemGroup0::StatementBlock(b) => self.sub(sc, &b.statement_block, cx)?,
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
                out.push(Stmt::Case(sel, arms, def));
                Ok(())
            }
            Statement::SwitchStatement(x) => {
                let (mut arms, mut def) = (vec![], vec![]);
                for it in &x.switch_statement.switch_statement_list {
                    let si = &it.switch_item;
                    let body = match &*si.switch_item_group0 {
                        SwitchItemGroup0::Statement(s) => { let mut v = vec![]; self.lower_stmt(sc, &s.statement, cx, &mut v)?; v }
                        SwitchItemGroup0::StatementBlock(b) => self.sub(sc, &b.statement_block, cx)?,
                    };
                    match &*si.switch_item_group {
                        SwitchItemGroup::Defaul(_) => def = body,
                        SwitchItemGroup::SwitchCondition(cc) => {
                            let cc = &cc.switch_condition;
                            let mut conds = vec![self.parse_in(sc, &toks(|k| k.expression(&cc.expression)))?];
                            for y in &cc.switch_condition_list { conds.push(self.parse_in(sc, &toks(|k| k.expression(&y.expression)))?); }
                            arms.push((conds, body));
                        }
                    }
                }
                out.push(Stmt::Switch(arms, def));
                Ok(())
            }
            Statement::ForStatement(x) => {
                let f = &x.for_statement;
                if f.for_statement_opt.is_some() { return Err("`for ... in rev` is not supported".into()); }
                let name = f.identifier.identifier_token.to_string();
                let id = self.declare(sc, &name, &TypeInfo { two_state: true, ..TypeInfo::scalar(32) });
                let from = self.parse_in(sc, &toks(|k| k.expression(&f.range.expression)))?;
                let o = f.range.range_opt.as_ref().ok_or("for range needs `a..b`")?;
                let to = self.parse_in(sc, &toks(|k| k.expression(&o.expression)))?;
                let incl = toks(|k| k.range_operator(&o.range_operator)).join("") == "..=";
                let body = self.sub(sc, &f.statement_block, cx)?;
                out.push(Stmt::For { var: id, from, to, incl, body });
                Ok(())
            }
            Statement::ReturnStatement(x) => {
                let r = &x.return_statement;
                let e = self.parse_in(sc, &toks(|k| k.expression(&r.expression)))?;
                out.push(Stmt::Return(e));
                Ok(())
            }
            _ => Err("unsupported statement (break)".into()),
        }
    }

    fn range_item(&self, sc: &Scope, r: &Range) -> R<CaseArm> {
        let lo = self.parse_in(sc, &toks(|k| k.expression(&r.expression)))?;
        match &r.range_opt {
            None => Ok(CaseArm::V(lo)),
            Some(o) => {
                let hi = self.parse_in(sc, &toks(|k| k.expression(&o.expression)))?;
                let incl = toks(|k| k.range_operator(&o.range_operator)).join("") == "..=";
                Ok(CaseArm::R(lo, hi, incl))
            }
        }
    }

    fn lower_ident_stmt(&mut self, sc: &mut Scope, s: &IdentifierStatement, out: &mut Vec<Stmt>) -> R<()> {
        let lhs = toks(|c| c.expression_identifier(&s.expression_identifier));
        match &*s.identifier_statement_group {
            IdentifierStatementGroup::FunctionCall(f) => {
                let args = call_args(&f.function_call);
                if lhs.len() == 1 && lhs[0].starts_with('$') {
                    let mut a = vec![];
                    for t in &args { a.push(self.parse_in(sc, t)?); }
                    out.push(Stmt::Call(lhs[0].clone(), a));
                    return Ok(());
                }
                if lhs.len() == 3 && lhs[1] == "." {
                    let inst = *sc.sigs.get(&lhs[0]).ok_or(format!("unknown instance '{}'", lhs[0]))?;
                    match lhs[2].as_str() {
                        "next" => {
                            let n = match args.first() { Some(t) => self.parse_in(sc, t)?, None => Expr::Num(Val::new(32, 1)) };
                            out.push(Stmt::Wait(inst, n));
                            return Ok(());
                        }
                        "assert" => {
                            let clk = match args.first() {
                                Some(t) => *sc.sigs.get(&t[0]).ok_or("rst.assert(clk): unknown clock")?,
                                None => *self.tb_clk.get(&inst).ok_or("rst.assert() needs a clock (use `$tb::reset_gen(clk)` or `rst.assert(clk)`)")?,
                            };
                            let lv = LValue { sig: inst, sel: Sel::All };
                            out.push(Stmt::Assign(lv.clone(), Expr::Num(Val::new(1, 0))));
                            out.push(Stmt::Wait(clk, Expr::Num(Val::new(32, 2))));
                            out.push(Stmt::Assign(lv, Expr::Num(Val::new(1, 1))));
                            return Ok(());
                        }
                        _ => {}
                    }
                }
                // user function called as a statement (return value discarded)
                let joined = lhs.join("");
                if self.sim.funcs.contains_key(&joined) {
                    let mut a = vec![];
                    for t in &args { a.push(self.parse_in(sc, t)?); }
                    out.push(Stmt::Call(joined, a));
                    return Ok(());
                }
                Err(format!("unsupported call `{}`", lhs.join("")))
            }
            IdentifierStatementGroup::Assignment(a) => {
                let a = &a.assignment;
                let target = self.parse_in(sc, &lhs)?;
                let lv = to_lvalue(&target)?;
                let rhs = self.parse_in(sc, &toks(|c| c.expression(&a.expression)))?;
                let e = match &*a.assignment_group {
                    AssignmentGroup::Equ(_) => rhs,
                    AssignmentGroup::AssignmentOperator(o) => {
                        let op = toks(|c| c.assignment_operator(&o.assignment_operator)).join("");
                        let op = op.trim_end_matches('=').to_string();
                        Expr::Bin(op, Box::new(target), Box::new(rhs))
                    }
                    _ => return Err("`<>` operator is not supported".into()),
                };
                out.push(Stmt::Assign(lv, e));
                Ok(())
            }
        }
    }
}
