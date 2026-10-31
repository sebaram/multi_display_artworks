import { lazy } from "react";
import { useSearchParams } from "react-router-dom";
import ImageElement from "./ImageElement";

const Room = lazy(() => import("../room/Room"));

export default function ElementEntry() {
  const [params] = useSearchParams();
  const type = params.get("type") || "image";
  const elementId = params.get("wall_element_id");
  return type === "image" && params.get("display_type") !== "aframe" ? (
    <ImageElement key={elementId} elementId={elementId} />
  ) : (
    <Room mode="element" />
  );
}
