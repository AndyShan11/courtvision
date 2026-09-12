// Shared sampling contract: RGB area average, round-half-up grayscale, floor crop.
export function canonicalGray(rgba, sourceWidth, sourceHeight, width = 160, height = 90) {
  return areaSample(rgba, sourceWidth, sourceHeight, width, height, false).grayscale;
}

export function canonicalFrame(rgba, sourceWidth, sourceHeight, width = 160, height = 90) {
  return areaSample(rgba, sourceWidth, sourceHeight, width, height, true);
}

function areaSample(rgba, sourceWidth, sourceHeight, width, height, includeColor) {
  if (![sourceWidth, sourceHeight, width, height].every(n => Number.isInteger(n) && n > 0)
      || rgba.length !== sourceWidth * sourceHeight * 4) throw new Error("无效视频像素尺寸");
  const output = new Uint8Array(width * height);
  const pixels = includeColor ? new Uint8ClampedArray(width * height * 4) : null;
  const scaleX = sourceWidth / width, scaleY = sourceHeight / height;
  for (let y = 0; y < height; y++) {
    const top = y * scaleY, bottom = (y + 1) * scaleY;
    for (let x = 0; x < width; x++) {
      const left = x * scaleX, right = (x + 1) * scaleX;
      let value = 0;
      let red = 0, green = 0, blue = 0;
      for (let sy = Math.floor(top); sy < Math.min(sourceHeight, Math.ceil(bottom)); sy++) {
        const wy = Math.min(sy + 1, bottom) - Math.max(sy, top);
        for (let sx = Math.floor(left); sx < Math.min(sourceWidth, Math.ceil(right)); sx++) {
          const wx = Math.min(sx + 1, right) - Math.max(sx, left);
          const i = (sy * sourceWidth + sx) * 4;
          value += (.299 * rgba[i] + .587 * rgba[i + 1] + .114 * rgba[i + 2]) * wx * wy;
          if (includeColor) {
            red += rgba[i] * wx * wy;
            green += rgba[i + 1] * wx * wy;
            blue += rgba[i + 2] * wx * wy;
          }
        }
      }
      output[y * width + x] = Math.floor(value / (scaleX * scaleY) + .5);
      if (pixels) {
        const index = (y * width + x) * 4, area = scaleX * scaleY;
        pixels[index] = Math.floor(red / area + .5);
        pixels[index + 1] = Math.floor(green / area + .5);
        pixels[index + 2] = Math.floor(blue / area + .5);
        pixels[index + 3] = 255;
      }
    }
  }
  return { grayscale: output, pixels, width, height };
}

// Native-size drawing avoids the browser's implementation-defined resize filter.
// Decode/color-conversion differences still require real-browser validation.
export function createCanonicalFrameReader(video, width = 160, height = 90) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return () => {
    if (!context) throw new Error("无法创建视频采样画布");
    const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight || video.readyState < 2) throw new Error("视频帧尚未就绪");
    if (canvas.width !== sourceWidth) canvas.width = sourceWidth;
    if (canvas.height !== sourceHeight) canvas.height = sourceHeight;
    context.drawImage(video, 0, 0, sourceWidth, sourceHeight);
    return canonicalFrame(context.getImageData(0, 0, sourceWidth, sourceHeight).data,
      sourceWidth, sourceHeight, width, height);
  };
}

export function smoothPanSamples(samples) {
  return samples.map((item, index) => {
    let sum = 0;
    for (let i = index - 2; i <= index + 2; i++) sum += samples[i]?.rawPanScore || 0;
    return { ...item, panScore: sum / 5 };
  });
}

export function seekDecodedFrame(video, target, timeoutMs = 10000, {expectedMediaTime = null} = {}) {
  if (expectedMediaTime !== null && !Number.isFinite(expectedMediaTime)) return Promise.reject(new Error('无效目标帧时间'));
  return new Promise((resolve, reject) => {
    let frameId, timer, finished = false, lastMediaTime = null;
    let phase = "target", seekStartedAt = performance.now(), pendingFrame = null;
    const finish = (error, metadata) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      error ? reject(error) : resolve(metadata);
    };
    const onError = () => finish(new Error("录像解码失败"));
    const onFrame = (_now, metadata) => {
      lastMediaTime = metadata.mediaTime;
      // Chromium can present the target frame BEFORE clearing `seeking` / firing seeked.
      // Keep that frame until seek completion, but reject frames presented before this seek.
      const fresh = Number.isFinite(metadata.presentationTime) && metadata.presentationTime >= seekStartedAt;
      const matchesTarget = expectedMediaTime === null
        ? Math.abs(metadata.mediaTime - target) <= .12
        : Math.abs(metadata.mediaTime - expectedMediaTime) <= 1e-6;
      if (phase === "target" && fresh && matchesTarget) {
        pendingFrame = metadata;
        if (!video.seeking) { finish(null, metadata); return; }
      }
      frameId = video.requestVideoFrameCallback(onFrame);
    };
    const onSeeked = () => {
      if (!video.requestVideoFrameCallback) finish(new Error("此浏览器不支持精确视频帧回调，请使用新版 Chrome 或 Edge"));
      else if (phase === "away") {
        // Do not issue both seeks in one task: browsers may coalesce them.
        phase = "target";
        pendingFrame = null;
        seekStartedAt = performance.now();
        try { video.currentTime = target; } catch (error) { finish(error); }
      } else if (!video.seeking && pendingFrame) {
        finish(null, pendingFrame);
      }
    };
    timer = setTimeout(() => finish(new Error(`等待目标视频帧超时：目标 ${target}，实际 ${lastMediaTime ?? "未收到帧回调"}`)), timeoutMs);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    if (!video.requestVideoFrameCallback) { onSeeked(); return; }
    frameId = video.requestVideoFrameCallback(onFrame);
    // Force a completed intermediate seek, including when the target is zero.
    try {
      if (Math.abs(video.currentTime - target) < .001) {
        phase = "away";
        const duration = video.duration;
        const canMoveForward = !Number.isFinite(duration) || target + .15 < duration;
        const away = target >= .15 ? target - .15 : canMoveForward ? target + .15 : target > 0 ? 0 : duration / 2;
        if (!Number.isFinite(away) || away === target) throw new Error("录像长度不足，无法重新定位视频帧");
        video.currentTime = away;
      } else {
        seekStartedAt = performance.now();
        video.currentTime = target;
      }
    } catch (error) { finish(error); }
  });
}
