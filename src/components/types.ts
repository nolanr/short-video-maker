export enum AvailableComponentsEnum {
  PortraitVideo = "ShortVideo",
  LandscapeVideo = "LandscapeVideo",
  ClipVideo = "ClipVideo",
}
export type OrientationConfig = {
  width: number;
  height: number;
  component: AvailableComponentsEnum;
};
