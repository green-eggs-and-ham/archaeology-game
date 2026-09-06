window.AssetLoader = class AssetLoader {
  constructor() {
    this.assets = {
      images: {},
      sounds: {}
    };
  }

  loadImage(key, path) {
    this.assets.images[key] = loadImage(path);
  }

  loadSound(key, path) {
    this.assets.sounds[key] = loadSound(path);
  }
};
