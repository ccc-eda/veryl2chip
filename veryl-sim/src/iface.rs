//! Veryl interfaces, shared by the simulator and veryl-eda: the interface
//! declarations of a source, an interface's generate items (its variables
//! and logic), and the members of a modport with their direction as seen
//! from the module that uses it (`name: input`, ..., `..input`,
//! `..output`, `..same(other)`, `..converse(other)`).

use veryl_parser::veryl_grammar_trait::*;
use veryl_parser::veryl_walker::VerylWalker;
use veryl_parser::TokenCollector;

fn toks<F: FnOnce(&mut TokenCollector)>(f: F) -> Vec<String> {
    let mut c = TokenCollector::default();
    f(&mut c);
    c.tokens.iter().map(|t| t.to_string()).collect()
}

/// every interface declared in a description group
pub fn collect<'a>(g: &'a DescriptionGroup, out: &mut Vec<&'a InterfaceDeclaration>) {
    match &*g.description_group_group {
        DescriptionGroupGroup::DescriptionItem(x) => {
            if let DescriptionItem::DescriptionItemOptPublicDescriptionItem(y) = &*x.description_item {
                if let PublicDescriptionItem::InterfaceDeclaration(z) = &*y.public_description_item { out.push(&z.interface_declaration); }
            }
        }
        DescriptionGroupGroup::LBraceDescriptionGroupGroupListRBrace(x) => {
            for y in &x.description_group_group_list { collect(&y.description_group, out); }
        }
    }
}

pub fn name(d: &InterfaceDeclaration) -> String { d.identifier.identifier_token.to_string() }

fn walk<'a>(g: &'a InterfaceGroup, items: &mut Vec<&'a GenerateItem>, mps: &mut Vec<&'a ModportDeclaration>) {
    match &*g.interface_group_group {
        InterfaceGroupGroup::InterfaceItem(x) => match &*x.interface_item {
            InterfaceItem::GenerateItem(y) => items.push(&y.generate_item),
            InterfaceItem::ModportDeclaration(y) => mps.push(&y.modport_declaration),
            InterfaceItem::MixinDeclaration(_) => {}
        },
        InterfaceGroupGroup::LBraceInterfaceGroupGroupListRBrace(x) => {
            for y in &x.interface_group_group_list { walk(&y.interface_group, items, mps); }
        }
    }
}

/// the generate items (variables, lets, assigns, ...) of an interface
pub fn items(d: &InterfaceDeclaration) -> Vec<&GenerateItem> {
    let (mut items, mut mps) = (vec![], vec![]);
    for l in &d.interface_declaration_list { walk(&l.interface_group, &mut items, &mut mps); }
    items
}

/// names of the interface's variables (var and let), in declaration order
pub fn vars(d: &InterfaceDeclaration) -> Vec<String> {
    items(d).iter().filter_map(|it| match it {
        GenerateItem::VarDeclaration(x) => Some(x.var_declaration.identifier.identifier_token.to_string()),
        GenerateItem::LetDeclaration(x) => Some(x.let_declaration.identifier.identifier_token.to_string()),
        _ => None,
    }).collect()
}

/// members of modport `mp`: (member, is output from the module's side)
pub fn modport(d: &InterfaceDeclaration, mp: &str) -> Result<Vec<(String, bool)>, String> {
    let (mut items, mut mps) = (vec![], vec![]);
    for l in &d.interface_declaration_list { walk(&l.interface_group, &mut items, &mut mps); }
    let vars = vars(d);
    fn resolve(d: &InterfaceDeclaration, mps: &[&ModportDeclaration], mp: &str, vars: &[String], depth: u32) -> Result<Vec<(String, bool)>, String> {
        if depth > 8 { return Err(format!("interface '{}': modport defaults refer to each other in a loop", name(d))); }
        let m = mps.iter().find(|m| m.identifier.identifier_token.to_string() == mp)
            .ok_or_else(|| format!("interface '{}' has no modport '{}'", name(d), mp))?;
        let t = toks(|c| c.modport_declaration(m));
        let open = t.iter().position(|x| x == "{").map(|i| i + 1).unwrap_or(0);
        let close = t.iter().rposition(|x| x == "}").unwrap_or(t.len());
        let body = &t[open..close];
        let mut out: Vec<(String, bool)> = vec![];
        let mut i = 0;
        while i < body.len() {
            if body[i] == "," { i += 1; continue; }
            if body[i] == ".." {
                let rest = &body[i + 1..];
                let others: Vec<String> = vars.iter().filter(|v| !out.iter().any(|(n, _)| n == *v)).cloned().collect();
                match rest.first().map(|x| x.as_str()) {
                    Some("input") => out.extend(others.into_iter().map(|v| (v, false))),
                    Some("output") => out.extend(others.into_iter().map(|v| (v, true))),
                    Some(k @ ("same" | "converse")) => {
                        for base in rest.iter().skip(2).take_while(|x| *x != ")").filter(|x| *x != ",") {
                            for (n, o) in resolve(d, mps, base, vars, depth + 1)? {
                                if out.iter().any(|(x, _)| *x == n) { continue; }
                                out.push((n, if k == "converse" { !o } else { o }));
                            }
                        }
                    }
                    o => return Err(format!("modport default {:?} is not supported", o)),
                }
                break;
            }
            let (member, dir) = (body[i].clone(), body.get(i + 2).ok_or("bad modport item")?.as_str());
            match dir {
                "input" => out.push((member, false)),
                "output" => out.push((member, true)),
                "import" => {} // a function import: nothing to connect
                o => return Err(format!("modport direction '{}' is not supported", o)),
            }
            i += 3;
        }
        Ok(out)
    }
    resolve(d, &mps, mp, &vars, 0)
}
