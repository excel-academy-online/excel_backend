#!/usr/bin/env bash
# Switch root SSH login from password to key only - the bots guessing the
# root password can then never get in, however long they try.
#
# Step 1 (on your PC, once):  make a key and copy it to the server - see the
#          instructions printed by:   bash 03-ssh-keys.sh
# Step 2 (on the server):     bash 03-ssh-keys.sh --check
#          -> confirms your key is installed and that you logged in WITH it.
# Step 3 (on the server):     bash 03-ssh-keys.sh --apply
#          -> turns password login off (keeps a backup of the old config).
#
# To undo:  bash 03-ssh-keys.sh --undo   (turns password login back on)
set -euo pipefail

CFG=/etc/ssh/sshd_config
DROP=/etc/ssh/sshd_config.d/10-excel-keys-only.conf
MODE="${1:-help}"

keys() { [ -s /root/.ssh/authorized_keys ] && grep -cE '^(ssh-|ecdsa-)' /root/.ssh/authorized_keys || echo 0; }

case "$MODE" in
  help)
    cat <<'EOF'
On YOUR PC (PowerShell), once:
  1. Make a key (press Enter for the defaults; a passphrase is recommended):
       ssh-keygen -t ed25519 -C "excel-academy-vps"
  2. Copy it to the server (asks for the root password one last time):
       type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@209.74.80.220 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  3. Log in again - it should NOT ask for the root password now:
       ssh root@209.74.80.220
  4. On the server:  bash /root/vps-media/03-ssh-keys.sh --check
KEEP the key file (C:\Users\<you>\.ssh\id_ed25519) safe and backed up - it is now the way in.
Webuzo's own web panel keeps working with its password; this only affects SSH.
EOF
    ;;
  --check)
    n=$(keys)
    echo "Keys installed for root: $n"
    method=$(journalctl -u sshd --since "-2h" 2>/dev/null | grep -E "Accepted (publickey|password) for root" | tail -1 || true)
    echo "Your last root login: ${method:-unknown}"
    if [ "$n" -gt 0 ] && echo "$method" | grep -q publickey; then
      echo "OK - you logged in with a key. Safe to run:  bash $0 --apply"
    else
      echo "NOT YET - log in with your key first (step 3 above), then run --check again."
      exit 1
    fi
    ;;
  --apply)
    [ "$(keys)" -gt 0 ] || { echo "No key in /root/.ssh/authorized_keys - refusing (you'd be locked out)."; exit 1; }
    cp "$CFG" "$CFG.bak-$(date +%s)"
    mkdir -p /etc/ssh/sshd_config.d
    cat > "$DROP" <<'EOF'
# Excel Academy: root may log in with a key only; nobody with a password.
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
    # Older sshd_config may not include the .d folder; make sure it does, first.
    grep -qE '^\s*Include\s+/etc/ssh/sshd_config.d/\*\.conf' "$CFG" || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' "$CFG"
    sshd -t && systemctl reload sshd
    echo "Done - password login is off. KEEP THIS WINDOW OPEN and test from a new PowerShell window:"
    echo "  ssh root@209.74.80.220      (should log straight in with your key)"
    echo "If that fails, run here:  bash $0 --undo"
    ;;
  --undo)
    rm -f "$DROP"
    sshd -t && systemctl reload sshd
    echo "Password login is back on."
    ;;
  *) echo "Usage: bash $0 [--check | --apply | --undo]"; exit 1 ;;
esac
