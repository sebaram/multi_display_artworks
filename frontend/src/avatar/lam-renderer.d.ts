declare module "gaussian-splat-renderer-for-lam/build/gaussian-splat-renderer-for-lam.module.js" {
  export class GaussianSplatRenderer {
    static getInstance(
      container: HTMLElement,
      asset: string,
      options: {
        getExpressionData(): Record<string, number>;
        backgroundColor?: string;
        alpha?: number;
        loadProgress?(progress: number): void;
      },
    ): Promise<GaussianSplatRenderer | undefined>;
    getCamera?(): {
      position: { set(x: number, y: number, z: number): void };
      lookAt(x: number, y: number, z: number): void;
    };
    viewer?: {
      skinModel?: {
        geometry: { attributes: { position: { array: ArrayLike<number> } } };
        morphTargetDictionary?: Record<string, number>;
      };
      controls?: {
        target: { set(x: number, y: number, z: number): void };
        update(): void;
      };
    };
    dispose(): void;
  }
}
