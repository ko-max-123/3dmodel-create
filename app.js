/**
 * Cloudflare Workers のオリジン（末尾スラッシュなし）。
 * 例: https://rot3d-cha-api.your-subdomain.workers.dev
 * ローカル: http://127.0.0.1:8787
 */
const API_BASE = "http://127.0.0.1:8787";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let currentChallengeId = null;
let currentMeshes = [];
let scene;
let camera;
let renderer;
let controls;

function setStatus(text, kind = "") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind === "ok") el.classList.add("ok");
  if (kind === "err") el.classList.add("err");
}

function disposeCurrentCloud() {
  for (const mesh of currentMeshes) {
    scene.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
  currentMeshes = [];
}

function renderPointCloud(points, sphereRadius) {
  disposeCurrentCloud();

  const charPts = [];
  const noisePts = [];
  for (const p of points) {
    const [x, y, z, kind] = p;
    if (kind === 0) charPts.push([x, y, z]);
    else noisePts.push([x, y, z]);
  }

  const dummy = new THREE.Object3D();

  function addInstancedMesh(list, color, scaleMul) {
    if (list.length === 0) return;
    const geom = new THREE.IcosahedronGeometry(sphereRadius, 1);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, y, z] = list[i];
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(scaleMul);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    currentMeshes.push(mesh);
  }

  addInstancedMesh(charPts, 0xffdd66, 1.0);
  addInstancedMesh(noisePts, 0x8899aa, 0.82);
}

function fitCameraToBounds(bounds) {
  const dist = bounds * 0.55;
  camera.position.set(dist * 0.85, dist * 0.55, dist * 0.95);
  camera.near = 0.05;
  camera.far = Math.max(100, bounds * 8);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

function initThree() {
  const wrap = document.getElementById("canvasWrap");
  if (!wrap) return;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  wrap.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  const resize = () => {
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  window.addEventListener("resize", resize);

  const tick = () => {
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();
}

async function fetchChallenge() {
  setStatus("問題を取得しています…");
  const res = await fetch(`${API_BASE}/api/challenge`);
  if (!res.ok) {
    setStatus(`取得に失敗しました (${res.status})。API_BASE を確認してください。`, "err");
    throw new Error("challenge fetch failed");
  }

  const data = await res.json();
  currentChallengeId = data.challengeId;

  const lenEl = document.getElementById("answerLength");
  if (lenEl && typeof data.length === "number") lenEl.textContent = String(data.length);

  const r = data.render?.sphereRadius ?? 0.045;
  const bounds = data.render?.bounds ?? 8;
  renderPointCloud(data.points, r);
  fitCameraToBounds(bounds);

  setStatus("問題を表示しました。回転・ズームして読み取ってください。");
}

async function submitAnswer() {
  const input = document.getElementById("answerInput");
  if (!input) return;

  if (!currentChallengeId) {
    setStatus("先に「問題を取得」を押してください。", "err");
    return;
  }

  const answer = input.value.trim();
  if (!answer) {
    setStatus("回答を入力してください。", "err");
    return;
  }

  setStatus("検証中…");
  const res = await fetch(`${API_BASE}/api/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: currentChallengeId,
      answer,
    }),
  });

  let result;
  try {
    result = await res.json();
  } catch {
    setStatus("応答の解析に失敗しました。", "err");
    return;
  }

  if (result.ok) {
    setStatus("正解です。", "ok");
    currentChallengeId = null;
    input.value = "";
    await fetchChallenge();
    return;
  }

  const reason = result.reason ?? "incorrect";
  if (reason === "expired") {
    setStatus("チャレンジの有効期限切れです。新しい問題を取得します。", "err");
  } else {
    setStatus("不正解です。別の問題を取得します。", "err");
  }
  await fetchChallenge();
}

function wireUi() {
  document.getElementById("btnLoad")?.addEventListener("click", () => {
    fetchChallenge().catch(() => {});
  });
  document.getElementById("btnSubmit")?.addEventListener("click", () => {
    submitAnswer().catch(() => setStatus("通信エラー。", "err"));
  });
}

initThree();
wireUi();

fetchChallenge().catch(() => {
  setStatus(`API に接続できません。API_BASE（現在: ${API_BASE}）と CORS を確認してください。`, "err");
});
