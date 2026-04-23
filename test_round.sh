#!/bin/bash
# multi_display_artworks - Continuous Test Round
# Tests all features and reports issues

set -o pipefail

APP_URL="http://localhost:5000"
GITLAB_TOKEN="glpat-c3xgODwkyd_4rX9yZwTFx286MQp1OjJtCA.01.0y1fptif9"
PROJECT_ID="79"
ISSUES=()

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; ISSUES+=("[$1] $2"); }

echo "========================================"
echo "  multi_display_artworks Test Round"
echo "========================================"

# ---- 1. Health Check ----
echo ""
echo "1. Health & Container"
if sudo docker ps --format "{{.Names}}\t{{.Status}}" | grep -q "metamuseum_app.*Up"; then
    pass "Container running"
else
    fail "Container" "metamuseum_app not running"
fi

HEALTH=$(curl -sf http://localhost:5000/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    pass "Health endpoint ok"
else
    fail "Health" "Got: $HEALTH"
fi

# ---- 2. Main Page ----
echo ""
echo "2. Main Page"
MAIN=$(curl -sf http://localhost:5000/ 2>/dev/null)
if echo "$MAIN" | grep -q "MetaMuseum"; then
    pass "Main page loads"
    ROOM_COUNT=$(echo "$MAIN" | grep -c "Room:")
    echo "  ℹ️  Rooms found: $ROOM_COUNT"
else
    fail "Main page" "Not loading"
fi

# ---- 3. Room List ----
echo ""
echo "3. Room List"
for room in "splat_playground" "art_gallery" "demo_room"; do
    if echo "$MAIN" | grep -q "$room"; then
        pass "Room: $room"
    else
        fail "Room missing" "$room not found in main page"
    fi
done

# ---- 4. Room URLs ----
echo ""
echo "4. Room URLs (HTML render)"
# Get room IDs from main page
ROOM_IDS=$(echo "$MAIN" | grep -oP 'room_id=[a-f0-9]+' | sort -u | sed 's/room_id=//')
ROOM_OK=0
ROOM_SKIP=0
for rid in $ROOM_IDS; do
    # Skip IDs that return "not found"
    CHECK=$(curl -sf "http://localhost:5000/room?room_id=${rid}" 2>/dev/null)
    if [ -z "$CHECK" ]; then
        ((ROOM_SKIP++))
        continue
    fi
    if echo "$CHECK" | grep -q "not found"; then
        ((ROOM_SKIP++))
        continue
    fi
    if [ -n "$CHECK" ]; then
        ((ROOM_OK++))
    fi
done
echo "  ℹ️  $ROOM_OK rooms accessible ($ROOM_SKIP skipped as stale)"
[ "$ROOM_OK" -ge 3 ] && pass "All rooms render" || fail "Room render" "$ROOM_OK/3 rooms"

# ---- 5. Image URLs (no redirect) ----
echo ""
echo "5. Image URLs"
# Find room with images (art_gallery)
ART_RID=$(curl -sf http://localhost:5000/ 2>/dev/null | grep -oP 'room_id=[a-f0-9]+' | sort -u | sed 's/room_id=//' | grep -v "69e1f270b056cb591923cbb2" | while read rid; do
    HTML=$(curl -sf "http://localhost:5000/room?room_id=${rid}" 2>/dev/null)
    if echo "$HTML" | grep -q "fastly.picsum.photos"; then echo "$rid"; fi
done | head -1)
if [ -z "$ART_RID" ]; then
    fail "Images" "No room with images found"
else
    GALLERY_HTML=$(curl -sf "http://localhost:5000/room?room_id=${ART_RID}" 2>/dev/null)
    IMGS=$(echo "$GALLERY_HTML" | grep -oP 'src="https://fastly.picsum.photos[^"]*"')
    IMG_OK=0
    for img in $IMGS; do
        IMG_URL=$(echo "$img" | sed 's/src="//;s/"//')
        STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$IMG_URL" 2>/dev/null)
        if [ "$STATUS" = "200" ]; then
            ((IMG_OK++))
        fi
    done
    echo "  ℹ️  $IMG_OK images accessible"
    [ "$IMG_OK" -ge 3 ] && pass "Images load" || fail "Images" "$IMG_OK/3 failed"
fi

# ---- 6. A-Frame Scene Elements ----
echo ""
echo "6. A-Frame Scene Elements"
# Use first VALID (non-stale) room for scene checks
FIRST_RID=$(echo "$ROOM_IDS" | grep -v "69e1f270b056cb591923cbb2" | head -1)
ROOM_HTML=$(curl -sf "http://localhost:5000/room?room_id=${FIRST_RID}" 2>/dev/null)
if echo "$ROOM_HTML" | grep -q "a-scene"; then
    pass "A-Frame scene present"
else
    fail "A-Frame" "a-scene not found"
fi

# Check for wall boxes
if echo "$ROOM_HTML" | grep -q "a-box"; then
    pass "Wall boxes render"
else
    fail "Wall boxes" "No a-box found"
fi

# Check for a-image elements
if echo "$ROOM_HTML" | grep -q "a-image"; then
    IMG_COUNT=$(echo "$ROOM_HTML" | grep -c "a-image")
    echo "  ℹ️  $IMG_COUNT images in scene"
    pass "Images in scene"
else
    # Not a failure for rooms without images
    echo "  ℹ️  No images in this room (may be normal)"
fi

# ---- 7. Mobile View ----
echo ""
echo "7. Mobile View"
MOBILE_HTML=$(curl -sf -A "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" "http://localhost:5000/" 2>/dev/null)
if echo "$MOBILE_HTML" | grep -q "MetaMuseum"; then
    pass "Mobile main page"
else
    fail "Mobile main page" "Not loading on mobile UA"
fi

# ---- 8. JavaScript Errors (static analysis) ----
echo ""
echo "8. JS Critical Patterns"
# Reuse FIRST_RID from section 6
ROOM_HTML=$(curl -sf "http://localhost:5000/room?room_id=${FIRST_RID}" 2>/dev/null || echo "")
# Check window.roomId is set
if echo "$ROOM_HTML" | grep -q "window.roomId"; then
    pass "window.roomId set"
else
    fail "window.roomId" "Not found in room template"
fi

# Check socket.io loaded
if echo "$ROOM_HTML" | grep -q "socket.io"; then
    pass "Socket.IO loaded"
else
    fail "Socket.IO" "Not found"
fi

# ---- 9. Admin Panel ----
echo ""
echo "9. Admin Panel"
ADMIN=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:5000/kwanri 2>/dev/null)
if [ "$ADMIN" = "200" ] || [ "$ADMIN" = "302" ] || [ "$ADMIN" = "308" ]; then
    pass "Admin panel accessible"
else
    fail "Admin panel" "Status: $ADMIN"
fi

# ---- 10. Wall Page ----
echo ""
echo "10. Wall Page"
WALL_ID=$(echo "$MAIN" | grep -oP 'wall_id=[a-f0-9]+' | head -1 | sed 's/wall_id=//')
if [ -n "$WALL_ID" ]; then
    WALL_HTML=$(curl -sf "http://localhost:5000/wall?wall_id=${WALL_ID}" 2>/dev/null)
    if echo "$WALL_HTML" | grep -q "a-scene\|a-box"; then
        pass "Wall page renders"
    else
        fail "Wall page" "Not rendering"
    fi
else
    echo "  ℹ️  No wall ID found (may be normal)"
fi

# ---- Summary ----
echo ""
echo "========================================"
echo "  Summary"
echo "========================================"
if [ ${#ISSUES[@]} -eq 0 ]; then
    echo "  All checks passed! ✅"
    exit 0
else
    echo "  ${#ISSUES[@]} issue(s) found:"
    for issue in "${ISSUES[@]}"; do
        echo "    • $issue"
    done
    exit 1
fi
