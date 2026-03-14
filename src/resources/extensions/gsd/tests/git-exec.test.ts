import test from "node:test";
import assert from "node:assert/strict";
import { gitExec, GIT_NO_PROMPT_ENV } from "../git-exec.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

// ─── Setup / teardown ────────────────────────────────────────────────────────

function createTempGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "gsd-git-exec-test-"));
	execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
	return dir;
}

// ─── GIT_NO_PROMPT_ENV ──────────────────────────────────────────────────────

test("GIT_NO_PROMPT_ENV has GIT_TERMINAL_PROMPT=0", () => {
	assert.equal(GIT_NO_PROMPT_ENV.GIT_TERMINAL_PROMPT, "0");
});

test("GIT_NO_PROMPT_ENV has empty GIT_ASKPASS", () => {
	assert.equal(GIT_NO_PROMPT_ENV.GIT_ASKPASS, "");
});

test("GIT_NO_PROMPT_ENV inherits PATH from process.env", () => {
	assert.equal(GIT_NO_PROMPT_ENV.PATH, process.env.PATH);
});

// ─── gitExec basic operations ────────────────────────────────────────────────

test("gitExec returns trimmed stdout for a simple git command", () => {
	const dir = createTempGitRepo();
	try {
		const branch = gitExec(dir, ["branch", "--show-current"]);
		assert.equal(branch, "main");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitExec runs git rev-parse to verify repo", () => {
	const dir = createTempGitRepo();
	try {
		const result = gitExec(dir, ["rev-parse", "--is-inside-work-tree"]);
		assert.equal(result, "true");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ─── gitExec error handling ──────────────────────────────────────────────────

test("gitExec throws on failing command by default", () => {
	const dir = createTempGitRepo();
	try {
		assert.throws(
			() => gitExec(dir, ["log"]), // empty repo, git log fails
			/git log failed/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitExec returns empty string with allowFailure", () => {
	const dir = createTempGitRepo();
	try {
		const result = gitExec(dir, ["log"], { allowFailure: true });
		assert.equal(result, "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitExec throws for non-existent directory", () => {
	assert.throws(
		() => gitExec("/tmp/non-existent-dir-" + Date.now(), ["status"]),
		/failed/,
	);
});

// ─── gitExec with input (stdin piping) ───────────────────────────────────────

test("gitExec pipes input to stdin (git hash-object --stdin)", () => {
	const dir = createTempGitRepo();
	try {
		const hash = gitExec(dir, ["hash-object", "--stdin"], { input: "hello\n" });
		// "hello\n" always hashes to this SHA-1 in git
		assert.equal(hash, "ce013625030ba8dba906f756967f9e9ca394464a");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ─── Shell metacharacter safety (command injection regression test) ──────────

test("gitExec does not expand $() shell substitutions in args", () => {
	const dir = createTempGitRepo();
	try {
		// Create a commit so HEAD is valid
		execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
			cwd: dir,
			stdio: "ignore",
			env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
		});
		// With shell expansion, $(echo HEAD) would expand to HEAD and rev-parse would succeed.
		// With execFileSync (no shell), "$(echo HEAD)" is a literal ref name that doesn't exist.
		assert.throws(
			() => gitExec(dir, ["rev-parse", "--verify", "$(echo HEAD)"]),
			/failed/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitExec does not expand backtick shell substitutions in args", () => {
	const dir = createTempGitRepo();
	try {
		execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
			cwd: dir,
			stdio: "ignore",
			env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
		});
		// With shell, `echo HEAD` would expand. Without shell, it's a literal string.
		assert.throws(
			() => gitExec(dir, ["rev-parse", "--verify", "`echo HEAD`"]),
			/failed/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitExec passes semicolons as literal git arguments", () => {
	const dir = createTempGitRepo();
	try {
		execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
			cwd: dir,
			stdio: "ignore",
			env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
		});
		// With shell, "HEAD; echo pwned" would run two commands.
		// With execFileSync, it's a single argument to rev-parse that fails.
		assert.throws(
			() => gitExec(dir, ["rev-parse", "--verify", "HEAD; echo pwned"]),
			/failed/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
