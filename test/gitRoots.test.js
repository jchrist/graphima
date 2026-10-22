import { describe, it, beforeAll, afterAll, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRootStore } from "../src/git/index.js";
import { activate } from "../src/extension.js";
import { GitWindowPanel } from "../src/GitWindowPanel.js";
import { createFakeVscode } from "./helpers/fakeVscode.js";

const ex = promisify(execFile);

describe("createRootStore", () => {
  let fixtureDir;
  let repoDir;
  let plainDir;
  let projectsDir;
  let alphaDir;
  let betaDir;
  let worktreeDir;

  function fakeVscode(...dirs) {
    return {
      workspace: {
        workspaceFolders: dirs.map((d) => ({ uri: { fsPath: d } })),
      },
    };
  }

  beforeAll(async () => {
    const resultsDir = path.resolve("test-results");
    await fs.mkdir(resultsDir, { recursive: true });
    fixtureDir = await fs.mkdtemp(path.join(resultsDir, "graphima-roots-"));
    vi.stubEnv("GIT_CEILING_DIRECTORIES", fixtureDir);
    repoDir = path.join(fixtureDir, "repo");
    plainDir = path.join(fixtureDir, "plain");
    await fs.mkdir(repoDir);
    await fs.mkdir(plainDir);
    await ex("git", ["init", "-b", "main", "--quiet"], { cwd: repoDir });
    await ex("git", ["config", "user.email", "t@t"], { cwd: repoDir });
    await ex("git", ["config", "user.name", "t"], { cwd: repoDir });
    await ex("git", ["config", "commit.gpgsign", "false"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "f.txt"), "x\n");
    await ex("git", ["add", "f.txt"], { cwd: repoDir });
    await ex("git", ["commit", "-m", "init", "--quiet"], { cwd: repoDir });

    projectsDir = path.join(fixtureDir, "projects");
    alphaDir = path.join(projectsDir, "alpha");
    betaDir = path.join(projectsDir, "team", "beta");
    worktreeDir = path.join(projectsDir, "linked");
    await fs.cp(repoDir, alphaDir, { recursive: true });
    await fs.cp(repoDir, betaDir, { recursive: true });
    await ex("git", ["commit", "--allow-empty", "-m", "beta change", "--quiet"], {
      cwd: betaDir,
    });
    await ex("git", ["worktree", "add", "--detach", "--quiet", worktreeDir, "HEAD"], {
      cwd: alphaDir,
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("lists one entry per workspace folder with detected roots", async () => {
    const store = await createRootStore(fakeVscode(repoDir, plainDir));
    assert.equal(store.roots.length, 2);
    assert.equal(store.roots[0].root, repoDir);
    assert.equal(store.roots[1].root, null);
  });

  it("activates the first repository by default", async () => {
    const store = await createRootStore(fakeVscode(plainDir, repoDir));
    assert.equal(store.getActiveRoot(), repoDir);
  });

  it("switches active root and serves from it", async () => {
    const store = await createRootStore(fakeVscode(repoDir, plainDir));
    assert.deepEqual(store.useRoot(repoDir), { root: repoDir });
    const commits = await store.getService().listCommits(5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, "init");
  });

  it("rejects unknown roots", async () => {
    const store = await createRootStore(fakeVscode(repoDir));
    assert.throws(() => store.useRoot("/nope"), /Unknown repository/);
  });

  it("reports no repository when none is selected", async () => {
    const store = await createRootStore(fakeVscode(plainDir));
    assert.equal(store.getActiveRoot(), undefined);
    assert.throws(() => store.getService(), /No git repository selected/);
  });

  it("discovers sibling and grouped repositories and worktrees beneath a parent folder", async () => {
    const store = await createRootStore(fakeVscode(projectsDir));
    assert.deepEqual(store.roots, [
      { name: "alpha", folder: alphaDir, root: alphaDir },
      { name: "linked", folder: worktreeDir, root: worktreeDir },
      { name: path.join("team", "beta"), folder: betaDir, root: betaDir },
    ]);
    assert.equal(store.getActiveRoot(), alphaDir);
  });

  it("switches histories between discovered repositories and worktrees", async () => {
    const store = await createRootStore(fakeVscode(projectsDir));
    for (const [root, subject, count] of [
      [betaDir, "beta change", 2],
      [alphaDir, "init", 1],
      [worktreeDir, "init", 1],
    ]) {
      store.useRoot(root);
      const commits = await store.getService().listCommits(5);
      assert.equal(store.getActiveRoot(), root);
      assert.equal(commits.length, count);
      assert.equal(commits[0].subject, subject);
    }
  });

  it("deduplicates repositories from overlapping workspace folders", async () => {
    await fs.mkdir(path.join(alphaDir, "src"), { recursive: true });
    const store = await createRootStore(
      fakeVscode(projectsDir, alphaDir, path.join(alphaDir, "src")),
    );
    assert.deepEqual(
      store.roots.map((r) => r.root),
      [alphaDir, worktreeDir, betaDir],
    );
  });

  it("skips dependencies and symlink loops while scanning past invalid git markers", async () => {
    const scanDir = path.join(fixtureDir, "scan");
    const foundDir = path.join(scanDir, "broken", "real-repo");
    await fs.cp(repoDir, foundDir, { recursive: true });
    await fs.writeFile(path.join(scanDir, "broken", ".git"), "invalid git marker\n");
    await fs.cp(repoDir, path.join(scanDir, "node_modules", "dependency"), { recursive: true });
    await fs.symlink(scanDir, path.join(scanDir, "loop"), "junction");
    const store = await createRootStore(fakeVscode(scanDir, path.join(scanDir, "missing")));
    assert.deepEqual(
      store.roots.filter((r) => r.root).map((r) => r.root),
      [foundDir],
    );
  });

  it("answers parent-folder roots and switching requests through the extension", async () => {
    const previousPanel = GitWindowPanel.currentPanel;
    GitWindowPanel.currentPanel = undefined;
    const fake = createFakeVscode({ workspaceRoot: projectsDir });
    const context = { extensionUri: fake.vscode.Uri.file(process.cwd()), subscriptions: [] };
    try {
      activate(context, fake.vscode);
      await fake.commandsRegistered.get("graphima.openGitWindow")();
      const panel = fake.panels[0];
      await panel.handler({ type: "git/request", id: "roots", method: "roots" });
      const response = panel.posted.at(-1);
      assert.equal(response.ok, true);
      assert.deepEqual(
        response.data.roots.map((r) => r.root),
        [alphaDir, worktreeDir, betaDir],
      );
      await panel.handler({
        type: "git/request",
        id: "switch",
        method: "useRoot",
        args: { root: betaDir },
      });
      assert.equal(panel.posted.at(-1).ok, true);
      await panel.handler({ type: "git/request", id: "log", method: "log", args: { limit: 5 } });
      assert.equal(panel.posted.at(-1).ok, true);
      assert.equal(panel.posted.at(-1).data[0].subject, "beta change");
    } finally {
      GitWindowPanel.currentPanel?.dispose();
      GitWindowPanel.currentPanel = previousPanel;
      for (const disposable of context.subscriptions) {
        disposable.dispose();
      }
    }
  });
});
