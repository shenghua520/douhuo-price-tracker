#!/usr/bin/env bash
# 可靠地触发 GitHub 上的采价工作流 —— 供服务器 cron 使用。
#
# 为什么需要它：GitHub 自己的 schedule（workflow 里的 cron）实测极不可靠
# （本仓库 3 天只成功触发 1 次，还晚了 5 小时）。放在一台常开的机器上定时
# 调这个脚本，比依赖 GitHub 的 schedule 可靠得多。
#
# 部署方法（Ubuntu，2 分钟）：
#   1) 把「只读本仓库、Actions: Read and write」的细粒度令牌写进一个 600 权限的文件：
#        install -m 600 /dev/null ~/.douhuo-token
#        printf '%s' 'github_pat_xxxxxxxx' > ~/.douhuo-token
#   2) 让脚本可执行：
#        chmod +x scripts/trigger-remote.sh
#   3) crontab -e，加一行（服务器本地时间每天 09:17）：
#        17 9 * * * /path/to/repo/scripts/trigger-remote.sh >> /var/log/douhuo-trigger.log 2>&1
#
# 可用环境变量覆盖：DOUHUO_REPO / DOUHUO_WORKFLOW / DOUHUO_REF / DOUHUO_TOKEN_FILE
# 退出码：0 = 已成功通知 GitHub；非 0 = 失败（cron 会把输出寄给 root）

set -euo pipefail

REPO="${DOUHUO_REPO:-shenghua520/douhuo-price-tracker}"
WORKFLOW="${DOUHUO_WORKFLOW:-price-sync.yml}"
REF="${DOUHUO_REF:-main}"
TOKEN_FILE="${DOUHUO_TOKEN_FILE:-$HOME/.douhuo-token}"

if [ ! -r "$TOKEN_FILE" ]; then
  echo "找不到令牌文件：$TOKEN_FILE" >&2
  exit 1
fi

TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
if [ -z "$TOKEN" ]; then
  echo "令牌文件为空：$TOKEN_FILE" >&2
  exit 1
fi

URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches"

CODE="$(
  curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "User-Agent: douhuo-price-tracker-cron" \
    -d "{\"ref\":\"${REF}\"}" \
    "${URL}" 2>/dev/null || true
)"
CODE="$(printf '%s' "$CODE" | tr -cd '0-9')"
[ -n "$CODE" ] || CODE="000"

echo "$(date '+%F %T')  dispatch ${REPO} ${WORKFLOW}@${REF}  ->  HTTP ${CODE}"

if [ "$CODE" != "204" ]; then
  echo "触发失败（期望 204）。常见原因：401 令牌无效/过期；403 缺少 Actions: Read and write；404 令牌未授权该仓库。" >&2
  exit 1
fi
