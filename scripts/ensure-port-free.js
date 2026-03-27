const { execSync } = require("child_process");

const PORT = 30820;

function run(command) {
  return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
    .toString("utf8")
    .trim();
}

function getWindowsListeningPids(port) {
  try {
    const output = run(`cmd.exe /c netstat -ano -p tcp | findstr :${port}`);
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes("LISTENING"));

    const pids = new Set();
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  } catch {
    return [];
  }
}

function killWindowsPid(pid) {
  try {
    execSync(`cmd.exe /c taskkill /PID ${pid} /F`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (process.platform !== "win32") {
    return;
  }

  const pids = getWindowsListeningPids(PORT).filter(
    (pid) => pid !== process.pid,
  );

  if (pids.length === 0) {
    return;
  }

  console.log(
    `[prestart] Port ${PORT} is in use by PID(s): ${pids.join(", ")}. Attempting cleanup...`,
  );

  let allKilled = true;
  for (const pid of pids) {
    const ok = killWindowsPid(pid);
    allKilled = allKilled && ok;
  }

  const remaining = getWindowsListeningPids(PORT).filter(
    (pid) => pid !== process.pid,
  );

  if (remaining.length > 0 || !allKilled) {
    console.error(
      `[prestart] Failed to free port ${PORT}. Remaining PID(s): ${remaining.join(
        ", ",
      )}`,
    );
    process.exit(1);
  }

  console.log(`[prestart] Port ${PORT} is now free.`);
}

main();
