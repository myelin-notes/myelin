use std::path::Path;

#[derive(Default)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Default)]
pub struct RunPlan {
    pub source_filename: &'static str,
    /// Extra `(filename, contents)` files written into the run dir alongside
    /// the source, for languages whose run command needs a bootstrap.
    pub aux_files: Vec<(&'static str, &'static str)>,
    /// Environment overrides applied to the run command.
    pub env: Vec<(&'static str, &'static str)>,
    /// Candidate build commands tried in order; the first compiler present on
    /// PATH wins. Empty for interpreted languages.
    pub build: Vec<CommandSpec>,
    pub run: CommandSpec,
}

/// Maps a canonical language to its local toolchain plan. Aliases are resolved
/// frontend-side (`canonicalizeLanguage` in src/lib/code-runner/contract.ts),
/// which is the sole caller, so this only matches canonical names.
pub fn resolve_plan(language: &str, dir: &Path) -> Option<RunPlan> {
    let join = |name: &str| dir.join(name).to_string_lossy().to_string();
    let bin = join(&format!("main{}", std::env::consts::EXE_SUFFIX));

    let plan = match language.to_ascii_lowercase().as_str() {
        "python" => RunPlan {
            source_filename: "main.py",
            // The bootstrap execs main.py (resolved against the run dir, which
            // is the command's cwd) with rich-output support layered on.
            aux_files: vec![("_myelin_boot.py", include_str!("python_boot.py"))],
            env: vec![
                // Rich payloads must reach the UI as they are produced; block
                // buffering would hold them until the process exits.
                ("PYTHONUNBUFFERED", "1"),
                // Output is decoded as UTF-8 line by line, but Windows would
                // otherwise encode stdout in the ANSI codepage.
                ("PYTHONIOENCODING", "utf-8"),
                // Never let a plotting library try to open a GUI window from a
                // headless subprocess.
                ("MPLBACKEND", "Agg"),
            ],
            run: CommandSpec {
                program: python_program(),
                args: vec![join("_myelin_boot.py")],
            },
            ..Default::default()
        },
        "javascript" => RunPlan {
            source_filename: "main.js",
            run: CommandSpec {
                program: "node".into(),
                args: vec![join("main.js")],
            },
            ..Default::default()
        },
        "typescript" => RunPlan {
            source_filename: "main.ts",
            run: CommandSpec {
                program: "node".into(),
                args: vec![join("main.ts")],
            },
            ..Default::default()
        },
        "ruby" => RunPlan {
            source_filename: "main.rb",
            run: CommandSpec {
                program: "ruby".into(),
                args: vec![join("main.rb")],
            },
            ..Default::default()
        },
        "bash" => RunPlan {
            source_filename: "main.sh",
            run: CommandSpec {
                program: "bash".into(),
                args: vec![join("main.sh")],
            },
            ..Default::default()
        },
        "go" => RunPlan {
            source_filename: "main.go",
            run: CommandSpec {
                program: "go".into(),
                args: vec!["run".into(), join("main.go")],
            },
            ..Default::default()
        },
        "rust" => RunPlan {
            source_filename: "main.rs",
            build: vec![gnu_compile("rustc", &join("main.rs"), &bin)],
            run: CommandSpec {
                program: bin,
                args: vec![],
            },
            ..Default::default()
        },
        "c" => {
            let src = join("main.c");
            RunPlan {
                source_filename: "main.c",
                build: vec![
                    gnu_compile("cc", &src, &bin),
                    gnu_compile("clang", &src, &bin),
                    gnu_compile("gcc", &src, &bin),
                    msvc_compile(&src, &bin),
                ],
                run: CommandSpec {
                    program: bin,
                    args: vec![],
                },
                ..Default::default()
            }
        }
        "cpp" => {
            let src = join("main.cpp");
            RunPlan {
                source_filename: "main.cpp",
                build: vec![
                    gnu_compile("c++", &src, &bin),
                    gnu_compile("clang++", &src, &bin),
                    gnu_compile("g++", &src, &bin),
                    msvc_compile(&src, &bin),
                ],
                run: CommandSpec {
                    program: bin,
                    args: vec![],
                },
                ..Default::default()
            }
        }
        _ => return None,
    };

    Some(plan)
}

fn python_program() -> String {
    // The `python3` shim is absent on Windows; the launcher is just `python`.
    if cfg!(windows) { "python" } else { "python3" }.to_string()
}

/// A GCC/Clang-style compile (`<program> <source> -o <bin>`). `rustc` shares
/// this argument shape.
fn gnu_compile(program: &str, source: &str, bin: &str) -> CommandSpec {
    CommandSpec {
        program: program.to_string(),
        args: vec![source.to_string(), "-o".to_string(), bin.to_string()],
    }
}

/// An MSVC `cl` compile, which names the output with `/Fe:` instead of `-o`.
/// Always listed as a candidate; on non-Windows it just resolves to NotFound
/// and is skipped.
fn msvc_compile(source: &str, bin: &str) -> CommandSpec {
    CommandSpec {
        program: "cl".to_string(),
        args: vec![source.to_string(), format!("/Fe:{bin}")],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn unsupported_language_has_no_plan() {
        assert!(resolve_plan("nim", Path::new("/tmp/run")).is_none());
    }

    #[test]
    fn interpreted_plan_has_no_build() {
        let plan = resolve_plan("python", Path::new("/tmp/run")).unwrap();
        assert!(plan.build.is_empty());
        assert_eq!(plan.source_filename, "main.py");
    }

    #[test]
    fn compiled_plan_builds_then_runs_binary() {
        let plan = resolve_plan("rust", Path::new("/tmp/run")).unwrap();
        assert_eq!(plan.build.first().expect("rust has a build step").program, "rustc");
        assert!(plan.run.args.is_empty());
    }

    #[test]
    fn python_runs_through_the_rich_output_bootstrap() {
        let plan = resolve_plan("python", Path::new("/tmp/run")).unwrap();
        assert_eq!(plan.source_filename, "main.py");
        assert!(plan.run.args[0].ends_with("_myelin_boot.py"));
        let (name, contents) = plan.aux_files.first().expect("bootstrap is written");
        assert_eq!(*name, "_myelin_boot.py");
        assert!(contents.contains("myelin-display"));
        assert!(plan.env.iter().any(|(k, _)| *k == "PYTHONUNBUFFERED"));
    }

    #[test]
    fn cpp_offers_multiple_compiler_candidates() {
        let plan = resolve_plan("cpp", Path::new("/tmp/run")).unwrap();
        let programs: Vec<&str> = plan.build.iter().map(|c| c.program.as_str()).collect();
        assert_eq!(programs, vec!["c++", "clang++", "g++", "cl"]);
    }
}
