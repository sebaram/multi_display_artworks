import { translate as t } from "./i18n";

const errors: Record<string, [string, string]> = {
  invalid_credentials: [
    "이메일과 비밀번호를 확인하세요.",
    "Check your email and password.",
  ],
  authentication_required: ["로그인이 필요합니다.", "Please sign in."],
  admin_required: [
    "관리자 권한이 필요합니다.",
    "Administrator access is required.",
  ],
  csrf_denied: [
    "보안 확인이 만료됐습니다. 새로고침 후 다시 시도하세요.",
    "Security verification expired. Refresh and try again.",
  ],
  origin_denied: [
    "이 주소에서는 요청할 수 없습니다.",
    "Requests from this address are not allowed.",
  ],
  registration_closed: [
    "신규 가입은 운영자에게 문의하세요.",
    "Contact the administrator for a new account.",
  ],
  invalid_capability: [
    "방문자 연결이 만료됐습니다. 다시 입장하세요.",
    "Your visitor connection expired. Rejoin the room.",
  ],
  document_not_found: [
    "요청한 항목을 찾을 수 없습니다.",
    "The requested item was not found.",
  ],
  unknown_resource: [
    "요청한 리소스를 찾을 수 없습니다.",
    "The requested resource was not found.",
  ],
  invalid_object_id: [
    "항목 주소가 올바르지 않습니다.",
    "The item address is invalid.",
  ],
  unique_conflict: [
    "같은 이름의 항목이 이미 있습니다.",
    "An item with this name already exists.",
  ],
  document_is_referenced: [
    "다른 항목에서 사용 중입니다. 연결을 먼저 해제하세요.",
    "This item is in use. Remove its references first.",
  ],
  element_outside_wall_bounds: [
    "작품이 월의 경계를 벗어납니다.",
    "The artwork is outside the wall bounds.",
  ],
  invalid_document: ["입력값을 확인하세요.", "Check the entered values."],
  invalid_fields: ["입력 필드를 확인하세요.", "Check the input fields."],
  positive_dimension_required: [
    "크기는 0보다 커야 합니다.",
    "Dimensions must be greater than zero.",
  ],
  finite_number_required: [
    "유효한 숫자를 입력하세요.",
    "Enter a finite number.",
  ],
  finite_bounded_number_required: [
    "허용 범위 안의 숫자를 입력하세요.",
    "Enter a number within the allowed range.",
  ],
  invalid_vector: ["좌표 값을 확인하세요.", "Check the coordinate values."],
  invalid_boundary: ["공간 경계 값을 확인하세요.", "Check the room bounds."],
  preset_room_mismatch: [
    "같은 방의 위치를 선택하세요.",
    "Choose a location in the same room.",
  ],
  preset_is_referenced_in_another_room: [
    "다른 방에서 사용 중인 위치입니다.",
    "This location is referenced by another room.",
  ],
  value_required: ["필수 항목을 입력하세요.", "Complete the required field."],
  invalid_datetime: ["날짜와 시각을 확인하세요.", "Check the date and time."],
  "Failed to fetch": [
    "연결하지 못했습니다. 네트워크를 확인하세요.",
    "Unable to connect. Check your network.",
  ],
  image_required: ["작품을 선택하세요.", "Select an artwork."],
  invalid_image_url: [
    "이미지 주소가 올바르지 않습니다.",
    "The image URL is invalid.",
  ],
  image_load_failed: [
    "이미지를 불러오지 못했습니다.",
    "Unable to load the image.",
  ],
  artwork_image_failed: [
    "작품 이미지를 불러오지 못했습니다.",
    "Unable to load the artwork image.",
  ],
  model_loader_failed: [
    "3D 모델 로더를 불러오지 못했습니다.",
    "Unable to load the 3D model loader.",
  ],
  model_scene_missing: [
    "모델의 장면을 찾지 못했습니다.",
    "The model scene was not found.",
  ],
  media_load_failed: ["불러오지 못했습니다.", "Unable to load."],
  splat_renderer_failed: [
    "Gaussian splat 렌더러를 불러오지 못했습니다. 작품 원본 링크에서 확인하세요.",
    "Unable to load the Gaussian splat renderer. Open the original artwork link.",
  ],
};

/** Translate known application errors; retain unknown provider diagnostics verbatim. */
export function displayError(message: string): string {
  const pair =
    errors[message] ||
    Object.values(errors).find((pair) => pair.includes(message));
  if (pair) return t(...pair);
  for (const [ko, en] of [
    ["3D 모델: ", "3D model: "],
    ["Gaussian splat: ", "Gaussian splat: "],
  ]) {
    const prefix = message.startsWith(ko)
      ? ko
      : message.startsWith(en)
        ? en
        : undefined;
    if (prefix) return t(ko, en) + displayError(message.slice(prefix.length));
  }
  if (message.startsWith("{")) {
    try {
      const detail = JSON.parse(message);
      if (typeof detail.message === "string" && errors[detail.message]) {
        const fields = Array.isArray(detail.fields)
          ? detail.fields.join(", ")
          : detail.field;
        return t(...errors[detail.message]) + (fields ? ` (${fields})` : "");
      }
    } catch {
      /* Preserve diagnostics that are not JSON error details. */
    }
  }
  return message;
}
