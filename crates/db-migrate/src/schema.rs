#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MigrationStep {
    pub id: &'static str,
    pub sql: &'static str,
}

#[derive(Clone, Copy)]
pub struct DbSchema {
    pub steps: &'static [MigrationStep],
}
