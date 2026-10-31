import { translate as t } from "../../app/i18n";

const resources: Record<string, [string, string]> = {
  rooms: ["방", "Rooms"],
  walls: ["월", "Walls"],
  images: ["이미지", "Images"],
  splats: ["가우시안 스플랫", "Gaussian splats"],
  gltfs: ["GLTF 모델", "GLTF models"],
  webpages: ["웹페이지", "Webpages"],
  locations: ["이동 위치", "Locations"],
  effects: ["효과", "Effects"],
  markers: ["마커", "Markers"],
  "llm-configs": ["AI 설정", "AI settings"],
  "whisper-configs": ["음성 인식 설정", "Speech recognition settings"],
};
export function resourceLabel(name: string, fallback: string) {
  return resources[name] ? t(...resources[name]) : fallback;
}

const fields: Record<string, string> = {
  name: "이름",
  description: "설명",
  room: "방",
  wall: "월",
  position: "위치",
  rotation: "회전",
  width: "너비",
  height: "높이",
  depth: "깊이",
  color: "색상",
  image_url: "이미지 URL",
  video_url: "영상 URL",
  splat_url: "스플랫 URL",
  gltf_url: "GLTF URL",
  webpage_url: "웹페이지 URL",
  cutout_scale: "잘라내기 크기",
  cutout_position: "잘라내기 위치",
  default_rotation: "기본 회전",
  is_default: "기본 위치",
  marker_type: "마커 유형",
  marker_value: "마커 값",
  target_preset: "대상 위치",
  is_active: "활성화",
  effect_type: "효과 유형",
  target_id: "대상 ID",
  params: "매개변수",
  created_by: "작성자",
  expires_at: "만료 시각",
  active: "활성화",
  provider: "제공자",
  api_base: "API 기본 URL",
  api_key: "API 키",
  model: "모델",
  temperature: "생성 다양성",
  max_tokens: "최대 토큰 수",
  language: "언어",
  enabled: "사용",
};
const transforms: Record<string, [string, string]> = {
  position: ["위치", "Position"],
  scale: ["크기", "Scale"],
  rotation: ["회전", "Rotation"],
  offset: ["오프셋", "Offset"],
  target_position: ["대상 위치", "Target position"],
  target_rotation: ["대상 회전", "Target rotation"],
};
export function fieldLabel(name: string, fallback: string) {
  if (fields[name]) return t(fields[name], fallback);
  const axis =
    /^(position|scale|rotation|offset|target_position|target_rotation)_([xyz])$/.exec(
      name,
    );
  if (axis) return `${t(...transforms[axis[1]])} ${axis[2].toUpperCase()}`;
  const boundary = /^boundary_(min|max)_([xyz])$/.exec(name);
  if (boundary)
    return t("경계 {limit} {axis}", fallback, {
      limit: boundary[1] === "min" ? "최솟값" : "최댓값",
      axis: boundary[2].toUpperCase(),
    });
  return fallback;
}
