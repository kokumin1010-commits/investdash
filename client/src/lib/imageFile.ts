/**
 * ブラウザで選択された画像ファイルを、サーバーに送れる data URL に変換する。
 *
 * iOS Safari では以下の理由で FileReader.readAsDataURL が失敗することがある。
 *   - 「The string did not match the expected pattern.」という TypeError が投げられる
 *   - HEIC/HEIF のまま渡される（file.type が空文字や image/heic になる）
 *   - 写真アプリ経由のファイルが読み取り中に無効化される
 *
 * そのため、canvas 経由で JPEG に再エンコードする方式を主経路とし、
 * 失敗した場合のみ FileReader にフォールバックする。canvas を通すことで
 * HEIC でもブラウザがデコードできる限り JPEG に変換され、同時に
 * 大きすぎる画像の縮小も行える。
 */

/** 送信する画像の最大辺（これを超える場合は縮小する） */
const MAX_DIMENSION = 2200;

/** JPEG 再エンコード時の品質。文字が潰れない程度に高めを維持する */
const JPEG_QUALITY = 0.92;

export type PreparedImage = {
  /** data:image/jpeg;base64,... 形式 */
  dataUrl: string;
  fileName: string;
  /** 変換後のバイト数（概算） */
  byteSize: number;
};

/** Blob URL を作って必ず解放する */
async function withObjectUrl<T>(file: Blob, fn: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    return await fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Blob URL 経由で HTMLImageElement を読み込む */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 読み込みが完了しないまま放置されるのを防ぐ
    const timer = window.setTimeout(() => reject(new Error("画像の読み込みがタイムアウトしました")), 30_000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("この形式の画像はブラウザで表示できません"));
    };
    img.src = url;
  });
}

/** canvas に描画して JPEG の data URL を得る */
async function viaCanvas(file: File): Promise<string> {
  const img = await withObjectUrl(file, loadImage);

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width === 0 || height === 0) {
    throw new Error("画像のサイズを判定できませんでした");
  }

  // 長辺が MAX_DIMENSION を超える場合のみ縮小（文字の可読性を保つため拡大はしない）
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました");

  // 縮小時の画質を優先
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 透過 PNG が黒くならないよう白で塗る
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!dataUrl.startsWith("data:image/jpeg")) {
    throw new Error("画像の変換に失敗しました");
  }
  return dataUrl;
}

/** FileReader によるフォールバック */
function viaFileReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:")) {
        resolve(result);
      } else {
        reject(new Error("画像を読み取れませんでした"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("画像を読み取れませんでした"));
    reader.onabort = () => reject(new Error("画像の読み取りが中断されました"));
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      // iOS Safari が同期的に TypeError を投げるケース
      reject(error instanceof Error ? error : new Error("画像を読み取れませんでした"));
    }
  });
}

/** 拡張子から画像かどうかを推測する（iOS では file.type が空になることがある） */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i;

export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  // iOS の写真アプリ経由では type が空文字になることがあるため拡張子でも判定する
  if (file.type === "" && IMAGE_EXTENSIONS.test(file.name)) return true;
  return false;
}

/**
 * 画像ファイルを送信可能な形式に変換する。
 * canvas 経由を優先し、失敗した場合は FileReader にフォールバックする。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let dataUrl: string;
  try {
    dataUrl = await viaCanvas(file);
  } catch (canvasError) {
    try {
      dataUrl = await viaFileReader(file);
    } catch {
      // 両方失敗した場合は canvas 側の理由を返す（原因が分かりやすい）
      const reason =
        canvasError instanceof Error ? canvasError.message : "画像を読み取れませんでした";
      throw new Error(reason);
    }
  }

  // base64 部分の長さからバイト数を概算する
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const byteSize = Math.floor((base64.length * 3) / 4);

  return {
    dataUrl,
    // 変換後は JPEG になるため拡張子を合わせる
    fileName: file.name.replace(IMAGE_EXTENSIONS, "") + ".jpg",
    byteSize,
  };
}
