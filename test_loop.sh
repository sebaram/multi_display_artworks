#!/bin/bash
# multi_display_artworks - Continuous Test Loop
# Runs test_round.sh indefinitely, debugs with Codex on failure

PROJECT_DIR="/home/uvr/.openclaw/workspace-coding_agent/projects/multi_display_artworks"
TEST_SCRIPT="$PROJECT_DIR/test_round.sh"
LOG="$PROJECT_DIR/test_loop.log"
ROUND=0
MAX_ROUNDS=50

echo "========================================" | tee $LOG
echo "  Test Loop Started: $(date)" | tee -a $LOG
echo "========================================" | tee -a $LOG

while [ $ROUND -lt $MAX_ROUNDS ]; do
    ROUND=$((ROUND+1))
    echo "" | tee -a $LOG
    echo "--- Round $ROUND -----------------------------------------------" | tee -a $LOG
    echo "Start: $(date '+%H:%M:%S')" | tee -a $LOG
    
    # Run test round
    OUTPUT=$($TEST_SCRIPT 2>&1)
    TEST_RESULT=$?
    echo "$OUTPUT" | tee -a $LOG
    
    if [ $TEST_RESULT -eq 0 ]; then
        echo "✅ Round $ROUND: PASS" | tee -a $LOG
        sleep 30
        continue
    fi
    
    # Extract issues
    ISSUES=$(echo "$OUTPUT" | grep "^    •" | sed 's/    • //')
    echo "❌ Round $ROUND: FAIL — Issues:" | tee -a $LOG
    echo "$ISSUES" | tee -a $LOG
    
    # Build Codex prompt
    ISSUE_LIST=$(echo "$ISSUES" | tr '\n' '|' | sed 's/|/\\n/g')
    CODEX_PROMPT="Fix the following test failures in the multi_display_artworks project at $PROJECT_DIR:

Issues found:
$ISSUES

The app is running at http://localhost:5000 (Docker container: metamuseum_app).

Steps:
1. First run: $PROJECT_DIR/test_round.sh to confirm the failures
2. Investigate each failure
3. Fix the code
4. Rebuild the Docker container: cd $PROJECT_DIR && sudo docker compose build app && sudo docker compose up -d app
5. Wait 10 seconds for the container to start
6. Run test_round.sh again to verify fixes
7. Commit changes with a descriptive message

Only fix the actual bugs — do not change unrelated code.
After fixing, respond with: FIXED: [brief summary of what was fixed]"

    echo "" | tee -a $LOG
    echo "🔧 Spawning Codex to debug..." | tee -a $LOG
    
    # Run Codex in background
    cd $PROJECT_DIR
    codex exec "$CODEX_PROMPT" > "$PROJECT_DIR/codex_debug_$ROUND.log" 2>&1 &
    CODEX_PID=$!
    echo "Codex PID: $CODEX_PID, waiting for completion..." | tee -a $LOG
    
    # Wait for Codex to finish (with timeout)
    WAIT_COUNT=0
    while kill -0 $CODEX_PID 2>/dev/null; do
        sleep 20
        WAIT_COUNT=$((WAIT_COUNT+1))
        if [ $WAIT_COUNT -gt 60 ]; then  # 20 min max
            echo "⚠️  Codex timeout, killing..." | tee -a $LOG
            kill $CODEX_PID 2>/dev/null
            break
        fi
    done
    
    # Show Codex output
    if [ -f "$PROJECT_DIR/codex_debug_$ROUND.log" ]; then
        echo "" | tee -a $LOG
        echo "Codex output:" | tee -a $LOG
        tail -30 "$PROJECT_DIR/codex_debug_$ROUND.log" | tee -a $LOG
    fi
    
    # Check if app is still running (Codex may have restarted things)
    if ! sudo docker ps --format "{{.Names}}" | grep -q "metamuseum_app"; then
        echo "⚠️  App container stopped, restarting..." | tee -a $LOG
        cd $PROJECT_DIR && sudo docker compose up -d app 2>&1 | tee -a $LOG
        sleep 10
    fi
    
    echo "Round $ROUND complete. Sleeping 30s before next round..." | tee -a $LOG
    sleep 30
done

echo "" | tee -a $LOG
echo "========================================" | tee -a $LOG
echo "  Test Loop Ended: $(date)" | tee -a $LOG
echo "  Rounds completed: $ROUND" | tee -a $LOG
echo "========================================" | tee -a $LOG
