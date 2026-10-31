import { translate as t } from "../../app/i18n";
import { displayError } from '../../app/error-message';

// Notices stay as data so a language change also updates an existing notice.
const messages: [string, string][] = [
  ["월을 새로고침하지 못했습니다.", "Could not refresh the wall."],
  ["전시 공간을 선택하세요.", "Select an exhibition space."],
  ["월을 선택하세요.", "Select a wall."],
  ["작품을 선택하세요.", "Select an artwork."],
  ["전시 링크를 복사했습니다.", "Exhibition link copied."],
  ["현재 위치를 저장했습니다.", "Current location saved."],
  ["저장했습니다.", "Saved."],
  ["변경을 되돌렸습니다.", "Changes reverted."],
  ["공유 재생에 연결하지 못했습니다. 연결 후 다시 시도하세요.", "Could not connect to shared playback. Connect and try again."],
  ["공유 재생 연결이 준비되지 않았습니다. 방 연결 상태를 확인하고 다시 시도하세요.", "Shared playback is not ready. Check the room connection and try again."],
  ["배치 제안을 미리 보고 있습니다. 적용하려면 아래 버튼을 누르세요.", "Previewing a layout suggestion. Use the button below to apply it."],
  ["효과를 적용했습니다.", "Effect applied."],
  ["배치를 저장했습니다.", "Layout saved."],
  ["효과를 해제했습니다.", "Effects cleared."],
  ["카메라 시작을 누르면 권한을 요청합니다.", "Press Start camera to request camera permission."],
  ["연결 중…", "Connecting…"],
  ["Socket.IO 연결됨", "Socket.IO connected"],
  ["연결 끊김 · 다시 연결 중", "Disconnected · Reconnecting"],
  ["SSE 수신 연결됨", "SSE receiver connected"],
  ["실시간 연결 오류", "Realtime connection error"],
  ["터치포인트 지움", "Touchpoints cleared"],
];
const prefixes: [string, string][] = [
  ["저장하지 못했습니다. 입력은 유지됩니다. ", "Could not save. Your input is kept. "],
  ["제스처: ", "Gesture: "],
  ["원격 선택: ", "Remote selection: "],
  ["일치: ", "Match: "],
];
export function localizeRoomMessage(message: string): string {
  const pair = messages.find(pair => pair.includes(message));
  if (pair) return t(...pair);
  for (const [ko, en] of prefixes) {
    const prefix = message.startsWith(ko) ? ko : message.startsWith(en) ? en : undefined;
    if (prefix) return t(ko, en) + displayError(message.slice(prefix.length));
  }
  return displayError(message);
}
