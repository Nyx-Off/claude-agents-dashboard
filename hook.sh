#!/bin/bash
# Claude Code hook for dashboard agent tracking.
# Usage: bash hook.sh pre   (PreToolUse)
#        bash hook.sh post  (PostToolUse)
#
# Claude Code provides `agent_id` and `agent_type` in the hook JSON
# for tool calls made by subagents. Parent-level tools have no agent_id.
# This lets us attribute each tool call to the correct agent precisely.

MODE="$1"
INPUT=$(cat)
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:8787}"

extract() {
  local field="$1" input="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$input" | jq -r ".$field // empty" 2>/dev/null
  else
    echo "$input" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}

extract_nested() {
  local field="$1" input="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$input" | jq -r ".tool_input.$field // empty" 2>/dev/null
  else
    echo "$input" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}

truncate80() {
  local s="$1"
  if [ ${#s} -gt 80 ]; then
    printf '%s...' "${s:0:77}"
  else
    printf '%s' "$s"
  fi
}

TOOL_NAME=$(extract tool_name "$INPUT")
# Claude Code provides agent_id for subagent tool calls (empty for parent)
AGENT_ID=$(extract agent_id "$INPUT")

# ── Path A: Agent tool — register new agent on PreToolUse only ──
if [ "$TOOL_NAME" = "Agent" ]; then
  [ "$MODE" != "pre" ] && exit 0

  DESC=$(extract_nested description "$INPUT")
  ATYPE=$(extract_nested subagent_type "$INPUT")
  PROMPT=$(extract_nested prompt "$INPUT")

  if command -v jq >/dev/null 2>&1; then
    PAYLOAD=$(jq -nc \
      --arg event "start" \
      --arg agent_type "${ATYPE:-general}" \
      --arg description "${DESC:-Working...}" \
      --arg prompt "${PROMPT:-}" \
      '{event:$event, agent_type:$agent_type, description:$description, prompt:$prompt}')
  else
    safe_desc=$(printf '%s' "${DESC:-Working...}" | sed 's/\\/\\\\/g;s/"/\\"/g')
    PAYLOAD=$(printf '{"event":"start","agent_type":"%s","description":"%s"}' \
      "${ATYPE:-general}" "$safe_desc")
  fi
  curl -s -X POST "$DASHBOARD_URL/api/event" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" --max-time 2 >/dev/null 2>&1
  exit 0
fi

# ── Path B: Tool calls from subagents (have agent_id) ──
# Ignore parent-level tools (no agent_id = not from a subagent)
[ -z "$AGENT_ID" ] && exit 0

TOOL_USE_ID=$(extract tool_use_id "$INPUT")

case "$TOOL_NAME" in
  Bash)            SUMMARY=$(truncate80 "$(extract_nested command "$INPUT")") ;;
  Read|Write|Edit) SUMMARY=$(extract_nested file_path "$INPUT") ;;
  Grep|Glob)       SUMMARY=$(truncate80 "$(extract_nested pattern "$INPUT")") ;;
  WebSearch)       SUMMARY=$(truncate80 "$(extract_nested query "$INPUT")") ;;
  WebFetch)        SUMMARY=$(extract_nested url "$INPUT") ;;
  Agent)           SUMMARY=$(extract_nested description "$INPUT") ;;
  *)               SUMMARY="$TOOL_NAME" ;;
esac

PHASE="$MODE"
RESULT_STATUS="ok"
if [ "$PHASE" = "post" ]; then
  if command -v jq >/dev/null 2>&1; then
    RESP=$(echo "$INPUT" | jq -r '.tool_response // empty' 2>/dev/null)
  else
    RESP=$(extract response "$INPUT")
  fi
  case "$RESP" in
    *[Ee]rror*|*FAIL*|*fail*) RESULT_STATUS="error" ;;
  esac
fi

if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -nc \
    --arg event "tool" \
    --arg agent_id "$AGENT_ID" \
    --arg tool_use_id "${TOOL_USE_ID:-tool_$$}" \
    --arg tool_name "$TOOL_NAME" \
    --arg summary "${SUMMARY:-$TOOL_NAME}" \
    --arg phase "$PHASE" \
    --arg result_status "$RESULT_STATUS" \
    '{event:$event, agent_id:$agent_id, tool_use_id:$tool_use_id, tool_name:$tool_name, summary:$summary, phase:$phase, result_status:$result_status}')
else
  safe_summary=$(printf '%s' "${SUMMARY:-$TOOL_NAME}" | sed 's/\\/\\\\/g;s/"/\\"/g')
  PAYLOAD=$(printf '{"event":"tool","agent_id":"%s","tool_use_id":"%s","tool_name":"%s","summary":"%s","phase":"%s","result_status":"%s"}' \
    "$AGENT_ID" "${TOOL_USE_ID:-tool_$$}" "$TOOL_NAME" "$safe_summary" "$PHASE" "$RESULT_STATUS")
fi

curl -s -X POST "$DASHBOARD_URL/api/event" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" --max-time 1 >/dev/null 2>&1

exit 0
