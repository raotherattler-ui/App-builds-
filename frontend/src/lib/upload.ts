import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getToken } from "./api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

/** Picks an image from the device gallery, uploads it, returns the public URL.
 *  `endpoint` defaults to the admin upload; customers use "/api/upload/review". */
export async function pickAndUploadImage(
  endpoint: string = "/api/upload",
  opts: { keepOriginal?: boolean } = {},
): Promise<{ url: string } | null> {
  // 1) Ask permission on native
  if (Platform.OS !== "web") {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("Photo library permission denied");
  }
  // 2) Pick
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    // keepOriginal: no re-compression, so animated GIFs stay animated (not flattened to JPEG)
    quality: opts.keepOriginal ? 1 : 0.85,
    allowsEditing: false,
    ...(opts.keepOriginal
      ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current }
      : {}),
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const uri = asset.uri;
  const isGif = asset.mimeType === "image/gif" || /\.gif$/i.test(asset.fileName || "") || /\.gif($|\?)/i.test(uri);
  const name = asset.fileName || `img_${Date.now()}.${isGif ? "gif" : "jpg"}`;
  const type = isGif ? "image/gif" : asset.mimeType || "image/jpeg";

  // 3) Upload — different body shape for web vs native
  const token = await getToken();
  const url = `${BASE}${endpoint}`;
  if (Platform.OS === "web") {
    let blob = await (await fetch(uri)).blob();
    if (isGif && blob.type !== "image/gif") blob = new Blob([blob], { type: "image/gif" });
    const form = new FormData();
    form.append("file", blob, name);
    const r = await fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!r.ok) throw new Error(`Upload failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    const abs = data.url?.startsWith("http") ? data.url : `${BASE}${data.relative_url}`;
    return { url: abs };
  } else {
    // Native path — use legacy uploadAsync which handles multipart properly
    const r = await FileSystem.uploadAsync(url, uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: type,
      parameters: {},
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Upload failed: ${r.status} ${r.body}`);
    }
    const data = JSON.parse(r.body);
    const abs = data.url?.startsWith("http") ? data.url : `${BASE}${data.relative_url}`;
    return { url: abs };
  }
}
