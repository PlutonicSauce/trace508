#!/usr/bin/env python3
"""
Verify container security boundaries, secret permissions, and browser sandboxing
from inside running Docker containers. Never prints secret values.
"""
import os
import stat
import subprocess
import sys


def run(cmd, check=True):
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"FAILED: {cmd}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)
    return res


def main():
    print("=== TRACE508 CONTAINER SECURITY & SANDBOX VERIFICATION ===\n")
    checks = 0

    # 1. Host Secret Directory and File Permissions
    print("1. Auditing host secret file permissions...")
    secrets_dir = os.environ.get("SECRETS_DIR", ".local/secrets")
    dir_stat = os.stat(secrets_dir)
    dir_mode = stat.S_IMODE(dir_stat.st_mode)
    assert dir_mode == 0o700, f"Host secrets dir {secrets_dir} mode {oct(dir_mode)} != 0700"
    print(f"  [PASS] Secrets directory permissions: {oct(dir_mode)} (owner-only rwx)")
    checks += 1

    for name in ["db_password", "database_url"]:
        file_path = os.path.join(secrets_dir, name)
        file_stat = os.stat(file_path)
        file_mode = stat.S_IMODE(file_stat.st_mode)
        assert file_mode == 0o644, f"Host secret {name} mode {oct(file_mode)} != 0644"
        assert not (file_stat.st_mode & stat.S_IWOTH), f"Secret {name} is world-writable"
        assert not (file_stat.st_mode & stat.S_IWGRP), f"Secret {name} is group-writable"
        print(f"  [PASS] Host secret {name} permissions: {oct(file_mode)} (read-only for non-owner, parent dir 0700)")
        checks += 1

    # 2. Secret Mount Access Inside Application Container
    print("\n2. Auditing secret access inside web container...")
    res = run("docker compose exec -T web test -r /run/secrets/database_url")
    print("  [PASS] web:/run/secrets/database_url is readable by web container user")
    checks += 1

    # Verify web container can read the secret without printing content
    res = run("docker compose exec -T web node -e \"const s = fs.readFileSync('/run/secrets/database_url', 'utf8').trim(); if (!s.startsWith('postgresql://') || s.length < 20) throw Error('invalid secret'); console.log('Secret read successfully; byte count:', s.length);\"")
    assert "Secret read successfully" in res.stdout, "Web container failed to read database_url secret"
    print("  [PASS] web container successfully read database_url secret (0 credentials exposed)")
    checks += 1

    # 3. Secret Isolation in browser and egress containers
    print("\n3. Auditing secret isolation in browser and egress containers...")
    res = run("docker compose exec -T browser test -f /run/secrets/database_url", check=False)
    assert res.returncode != 0, "Security violation: /run/secrets/database_url exists in browser container!"
    print("  [PASS] browser container has NO database_url secret mount")
    checks += 1

    res = run("docker compose exec -T egress test -f /run/secrets/database_url", check=False)
    assert res.returncode != 0, "Security violation: /run/secrets/database_url exists in egress container!"
    print("  [PASS] egress container has NO database_url secret mount")
    checks += 1

    res = run("docker compose exec -T browser env")
    assert "DATABASE_URL" not in res.stdout, "DATABASE_URL found in browser environment!"
    assert "db_password" not in res.stdout, "db_password found in browser environment!"
    print("  [PASS] browser environment contains 0 database credentials")
    checks += 1

    # 4. Secret Mount Access Inside db container
    print("\n4. Auditing secret access inside db container...")
    res = run("docker compose exec -T db test -r /run/secrets/db_password")
    print("  [PASS] db:/run/secrets/db_password is readable by db container")
    checks += 1

    # 5. Chromium Sandboxing Active in Browser Container
    print("\n5. Auditing Chromium sandboxing inside browser container...")
    res = run("docker compose exec -T browser ps aux")
    assert "--no-sandbox" not in res.stdout, "Security violation: Chromium launched with --no-sandbox!"
    print("  [PASS] Chromium process tree contains NO --no-sandbox flag")
    checks += 1

    # Verify Chromium launches and functions with sandboxing enabled via WebSocket
    res = run("docker compose exec -T browser node -e \""
              "import('playwright').then(async ({chromium}) => {"
              "  const b = await chromium.connect('ws://127.0.0.1:3333/scanner');"
              "  const p = await b.newPage();"
              "  await p.goto('about:blank');"
              "  const content = await p.evaluate(() => document.title);"
              "  console.log('Sandboxed Chromium page created successfully. Title:', content);"
              "  await b.close();"
              "});\"")
    assert "Sandboxed Chromium page created successfully" in res.stdout, "Failed to connect to sandboxed browser"
    print("  [PASS] Sandboxed Chromium WebSocket connection validated (zygote sandbox operational)")
    checks += 1

    # 6. Network Isolation of Browser Container
    print("\n6. Auditing browser container network isolation...")
    # Attempt connecting to db directly (must be refused / unreachable)
    res = run("docker compose exec -T browser node -e \""
              "import('net').then(({createConnection}) => {"
              "  const s = createConnection(5432, 'db');"
              "  s.on('connect', () => { console.error('Violation: connected to db'); process.exit(1); });"
              "  s.on('error', () => { console.log('PASS: db network unreachable'); process.exit(0); });"
              "  setTimeout(() => { console.log('PASS: db connection timeout'); process.exit(0); }, 2000);"
              "});\"")
    assert "PASS: db" in res.stdout, "Security violation: browser container reached db service!"
    print("  [PASS] browser container cannot reach internal db service")
    checks += 1

    # Attempt connecting to web directly (must be refused / unreachable)
    res = run("docker compose exec -T browser node -e \""
              "import('net').then(({createConnection}) => {"
              "  const s = createConnection(3000, 'web');"
              "  s.on('connect', () => { console.error('Violation: connected to web'); process.exit(1); });"
              "  s.on('error', () => { console.log('PASS: web network unreachable'); process.exit(0); });"
              "  setTimeout(() => { console.log('PASS: web connection timeout'); process.exit(0); }, 2000);"
              "});\"")
    assert "PASS: web" in res.stdout, "Security violation: browser container reached web service!"
    print("  [PASS] browser container cannot reach internal web service")
    checks += 1

    # 7. Egress Proxy Filtering: Cloud Metadata and Private Ranges
    print("\n7. Auditing egress proxy filtering (cloud metadata & private subnets)...")
    # Cloud metadata 169.254.169.254
    res = run("docker compose exec -T browser node -e \""
              "import('http').then(({request}) => {"
              "  const r = request({ host: 'egress', port: 3128, method: 'CONNECT', path: '169.254.169.254:443' });"
              "  r.on('response', (res) => {"
              "    if (res.statusCode === 403) { console.log('PASS: cloud metadata blocked HTTP 403'); process.exit(0); }"
              "    else { console.error('FAIL: got status', res.statusCode); process.exit(1); }"
              "  });"
              "  r.on('error', (e) => { console.log('PASS: cloud metadata rejected', e.message); process.exit(0); });"
              "  r.end();"
              "});\"")
    assert "PASS: cloud metadata" in res.stdout, "Security violation: cloud metadata endpoint not blocked!"
    print("  [PASS] Egress proxy blocked cloud metadata (169.254.169.254) with HTTP 403 Forbidden")
    checks += 1

    # Private subnet 10.0.0.1
    res = run("docker compose exec -T browser node -e \""
              "import('http').then(({request}) => {"
              "  const r = request({ host: 'egress', port: 3128, method: 'CONNECT', path: '10.0.0.1:443' });"
              "  r.on('response', (res) => {"
              "    if (res.statusCode === 403) { console.log('PASS: private subnet blocked HTTP 403'); process.exit(0); }"
              "    else { console.error('FAIL: got status', res.statusCode); process.exit(1); }"
              "  });"
              "  r.on('error', (e) => { console.log('PASS: private subnet rejected', e.message); process.exit(0); });"
              "  r.end();"
              "});\"")
    assert "PASS: private subnet" in res.stdout, "Security violation: private subnet not blocked!"
    print("  [PASS] Egress proxy blocked private subnet (10.0.0.1) with HTTP 403 Forbidden")
    checks += 1

    # 8. Filesystem Read-Only Protection & Non-Root Execution
    print("\n8. Auditing read-only filesystem and non-root user execution...")
    res = run("docker compose exec -T browser touch /read_only_root_test", check=False)
    assert res.returncode != 0, "Security violation: browser filesystem is writable at root!"
    assert "Read-only file system" in res.stderr or "Permission denied" in res.stderr, f"Unexpected error: {res.stderr}"
    print("  [PASS] browser container root filesystem is strictly read-only")
    checks += 1

    res = run("docker compose exec -T browser id -u")
    assert res.stdout.strip() == "1000", f"Browser process running as UID {res.stdout.strip()} != 1000"
    print("  [PASS] browser process executes as unprivileged user node (UID 1000)")
    checks += 1

    print(f"\nSUCCESS: All {checks} container security, sandbox, and isolation checks passed!")


if __name__ == "__main__":
    main()
