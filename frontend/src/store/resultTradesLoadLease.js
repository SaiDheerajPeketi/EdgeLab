export class ResultTradesLoadLease {
  #version = 0;
  #loadingOwner = null;

  begin(ownsLoading = false) {
    this.#version += 1;
    this.#loadingOwner = ownsLoading ? this.#version : null;
    return { loadingOwner: this.#loadingOwner, version: this.#version };
  }

  isCurrent(version) {
    return this.#version === version;
  }

  settle(version) {
    if (this.#loadingOwner !== version) return false;
    this.#loadingOwner = null;
    return true;
  }
}
