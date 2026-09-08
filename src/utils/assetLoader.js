window.AssetLoader = class AssetLoader {
  constructor() {
    this.assets = {
      images: {},
      sounds: {}
    };
  }

  loadImage(key, path) {
    window.GameBoot?.addResources(1);
    this.assets.images[key] = loadImage(
      path,
      () => window.GameBoot?.resourceLoaded(),
      () => window.GameBoot?.resourceFailed(`Image ${key}`)
    );
    return this.assets.images[key];
  }

  loadSound(key, path) {
    window.GameBoot?.addResources(1);
    this.assets.sounds[key] = loadSound(
      path,
      () => window.GameBoot?.resourceLoaded(),
      () => window.GameBoot?.resourceFailed(`Sound ${key}`)
    );
    return this.assets.sounds[key];
  }
};
