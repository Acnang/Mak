// --- 핵심 전역 설정 변수 ---
const CHUNK_SIZE = 16;
let renderDistance = 2; // 오버월드 청크 로딩 범위
let activeDimension = 'overworld';
let isThirdPerson = false;

let scene, camera, renderer;
let simplex = new SimplexNoise();
let loadedChunks = {}; // 오버월드 무한 청크 저장소
let fixedDimensionGroup = null; // 네더/엔더 고정 맵 그룹

// 플레이어 물리 엔진 및 사양
let player = {
    pos: new THREE.Vector3(0, 15, 0),
    vel: new THREE.Vector3(0, 0, 0),
    size: new THREE.Vector3(0.6, 1.8, 0.6),
    isGrounded: false
};

let playerMesh; // 3인칭 아바타 메시
let selectedBlockType = 1;

// 조이스틱 & 카메라 컨트롤 변수
let joystickInput = { x: 0, y: 0 };
let cameraRotation = { yaw: 0, pitch: 0 };
let isTouchingLook = false;
let lastTouchPos = { x: 0, y: 0 };
const keys = {};

// 차원별 재질 정의
const materials = {
    overworld: [
        new THREE.MeshLambertMaterial({ color: 0x4ade80 }), // Grass
        new THREE.MeshLambertMaterial({ color: 0x78350f }), // Dirt
        new THREE.MeshLambertMaterial({ color: 0x6b7280 }), // Stone
        new THREE.MeshLambertMaterial({ color: 0xb45309 }), // Wood
        new THREE.MeshLambertMaterial({ color: 0xc084fc })  // Ether
    ],
    nether: [
        new THREE.MeshLambertMaterial({ color: 0x7f1d1d }), // Netherrack
        new THREE.MeshLambertMaterial({ color: 0x451a03 }), // Basalt
        new THREE.MeshLambertMaterial({ color: 0xd97706 })  // Glowstone
    ],
    ender: [
        new THREE.MeshLambertMaterial({ color: 0xfef08a }), // End Stone
        new THREE.MeshLambertMaterial({ color: 0x3b0764 })  // Obsidian
    ]
};

const blockGeo = new THREE.BoxGeometry(1, 1, 1);

function init() {
    // 3D Scene 구성
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('webgl-canvas'), antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 조명
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(30, 50, 30);
    scene.add(dirLight);

    // 3인칭 플레이어 아바타 제작
    createPlayerAvatar();

    // 초기 환경 설정 및 맵 세팅
    setDimensionEnvironment('overworld');

    // UI 및 이벤트 핸들러 바인딩
    setupUI();
    setupBrawlStarsJoystick();
    setupInputEvents();

    // 메인 루프 시작
    animate();
}

function createPlayerAvatar() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xfcd34d });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), bodyMat);
    body.position.y = 0.45;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.1;
    group.add(head);

    playerMesh = group;
    scene.add(playerMesh);
}

// --- 오버월드 무한 청크 알고리즘 ---
function getChunkKey(cx, cz) {
    return `${cx},${cz}`;
}

function generateChunk(cx, cz) {
    const chunkGroup = new THREE.Group();
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = startX + x;
            const worldZ = startZ + z;

            const height = Math.floor(simplex.noise2D(worldX * 0.04, worldZ * 0.04) * 6) + 6;

            for (let y = 0; y <= height; y++) {
                let matIdx = 0;
                if (y < height - 2) matIdx = 2; // Stone
                else if (y < height) matIdx = 1; // Dirt

                const mesh = new THREE.Mesh(blockGeo, materials.overworld[matIdx]);
                mesh.position.set(worldX, y, worldZ);
                chunkGroup.add(mesh);
            }
        }
    }
    scene.add(chunkGroup);
    return chunkGroup;
}

function updateChunks() {
    if (activeDimension !== 'overworld') return;

    const pChunkX = Math.floor(player.pos.x / CHUNK_SIZE);
    const pChunkZ = Math.floor(player.pos.z / CHUNK_SIZE);
    const activeKeys = new Set();

    for (let x = -renderDistance; x <= renderDistance; x++) {
        for (let z = -renderDistance; z <= renderDistance; z++) {
            const key = getChunkKey(pChunkX + x, pChunkZ + z);
            activeKeys.add(key);

            if (!loadedChunks[key]) {
                loadedChunks[key] = generateChunk(pChunkX + x, pChunkZ + z);
            }
        }
    }

    // 범위 밖 청크 메모리 해제
    Object.keys(loadedChunks).forEach(key => {
        if (!activeKeys.has(key)) {
            scene.remove(loadedChunks[key]);
            delete loadedChunks[key];
        }
    });
}

// --- 네더 / 엔더 고정형 맵 생성 (렉 방지) ---
function generateFixedDimension(dim) {
    if (fixedDimensionGroup) scene.remove(fixedDimensionGroup);
    fixedDimensionGroup = new THREE.Group();

    const size = 24;
    for (let x = -size / 2; x < size / 2; x++) {
        for (let z = -size / 2; z < size / 2; z++) {
            const height = Math.floor(Math.sin(x * 0.3) * Math.cos(z * 0.3) * 3) + 5;
            for (let y = 0; y <= height; y++) {
                const matIdx = dim === 'nether' ? (y === height ? 0 : 1) : 0;
                const mesh = new THREE.Mesh(blockGeo, materials[dim][matIdx]);
                mesh.position.set(x, y, z);
                fixedDimensionGroup.add(mesh);
            }
        }
    }
    scene.add(fixedDimensionGroup);
}

function setDimensionEnvironment(dim) {
    activeDimension = dim;
    document.getElementById('dim-label').innerText = dim === 'overworld' ? '오버월드' : (dim === 'nether' ? '네더월드' : '엔더월드');

    // 오버월드 청크 초기화
    Object.keys(loadedChunks).forEach(k => scene.remove(loadedChunks[k]));
    loadedChunks = {};

    if (fixedDimensionGroup) {
        scene.remove(fixedDimensionGroup);
        fixedDimensionGroup = null;
    }

    if (dim === 'overworld') {
        scene.background = new THREE.Color(0x78a7ff);
        scene.fog = new THREE.FogExp2(0x78a7ff, 0.015);
        updateChunks();
    } else if (dim === 'nether') {
        scene.background = new THREE.Color(0x3f0707);
        scene.fog = new THREE.FogExp2(0x3f0707, 0.035);
        generateFixedDimension('nether');
    } else if (dim === 'ender') {
        scene.background = new THREE.Color(0x0a0518);
        scene.fog = new THREE.FogExp2(0x0a0518, 0.025);
        generateFixedDimension('ender');
    }
}

// --- 브롤스타즈 스타일 유연성 조이스틱 로직 ---
function setupBrawlStarsJoystick() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const handle = document.getElementById('joystick-handle');

    const maxRadius = 40;
    let activeTouchId = null;
    let centerPos = { x: 0, y: 0 };

    zone.addEventListener('touchstart', (e) => {
        if (activeTouchId !== null) return;
        const touch = e.changedTouches[0];
        activeTouchId = touch.identifier;

        const rect = zone.getBoundingClientRect();
        centerPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        updateJoystick(touch.clientX, touch.clientY);
    });

    window.addEventListener('touchmove', (e) => {
        if (activeTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                const touch = e.changedTouches[i];
                updateJoystick(touch.clientX, touch.clientY);
            }
        }
    });

    const resetJoystick = (e) => {
        if (activeTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                activeTouchId = null;
                handle.style.transform = `translate(-50%, -50%)`;
                joystickInput = { x: 0, y: 0 };
            }
        }
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);

    function updateJoystick(clientX, clientY) {
        let dx = clientX - centerPos.x;
        let dy = clientY - centerPos.y;
        let dist = Math.hypot(dx, dy);

        // 한계 반경 제한 내 각도 추적
        if (dist > maxRadius) {
            dx = (dx / dist) * maxRadius;
            dy = (dy / dist) * maxRadius;
        }

        handle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        joystickInput.x = dx / maxRadius;
        joystickInput.y = dy / maxRadius;
    }
}

// --- 복셀 AABB 물리 엔진 ---
function updatePhysics(delta) {
    // 입력 처리
    let inputX = joystickInput.x;
    let inputZ = joystickInput.y;

    if (keys['KeyW']) inputZ = -1;
    if (keys['KeyS']) inputZ = 1;
    if (keys['KeyA']) inputX = -1;
    if (keys['KeyD']) inputX = 1;

    const speed = 5.0;
    const forward = new THREE.Vector3(Math.sin(cameraRotation.yaw), 0, Math.cos(cameraRotation.yaw));
    const side = new THREE.Vector3(Math.cos(cameraRotation.yaw), 0, -Math.sin(cameraRotation.yaw));

    const moveDir = new THREE.Vector3()
        .addScaledVector(forward, -inputZ)
        .addScaledVector(side, inputX);

    if (moveDir.lengthSq() > 0) moveDir.normalize();

    player.vel.x = moveDir.x * speed;
    player.vel.z = moveDir.z * speed;

    // 중력 적용
    player.vel.y -= 20.0 * delta;

    // 위치 업데이트 및 바닥 충돌 판정
    player.pos.x += player.vel.x * delta;
    player.pos.z += player.vel.z * delta;
    player.pos.y += player.vel.y * delta;

    // 간이 Y축 충돌 체크
    if (player.pos.y <= 10.0) {
        player.pos.y = 10.0;
        player.vel.y = 0;
        player.isGrounded = true;
    } else {
        player.isGrounded = false;
    }

    // 1인칭 / 3인칭 시점 동기화
    playerMesh.position.copy(player.pos);
    playerMesh.rotation.y = cameraRotation.yaw;
    playerMesh.visible = isThirdPerson;

    if (isThirdPerson) {
        document.getElementById('crosshair').style.display = 'none';
        const dist = 4.5;
        camera.position.x = player.pos.x - Math.sin(cameraRotation.yaw) * dist;
        camera.position.z = player.pos.z - Math.cos(cameraRotation.yaw) * dist;
        camera.position.y = player.pos.y + 2.2 - Math.sin(cameraRotation.pitch) * 2;
    } else {
        document.getElementById('crosshair').style.display = 'block';
        camera.position.copy(player.pos).add(new THREE.Vector3(0, 1.4, 0));
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = cameraRotation.yaw;
    camera.rotation.x = cameraRotation.pitch;

    updateChunks();
}

// --- UI 및 이벤트 설정 ---
function setupUI() {
    renderHUD();

    document.getElementById('btn-menu').addEventListener('click', () => {
        document.getElementById('menu-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-menu').addEventListener('click', () => {
        document.getElementById('menu-modal').classList.add('hidden');
    });

    document.getElementById('chunk-slider').addEventListener('input', (e) => {
        renderDistance = parseInt(e.target.value);
        document.getElementById('chunk-val').innerText = renderDistance;
        updateChunks();
    });

    document.getElementById('btn-perspective').addEventListener('click', () => {
        isThirdPerson = !isThirdPerson;
    });

    document.getElementById('btn-jump').addEventListener('click', () => {
        if (player.isGrounded) player.vel.y = 7.5;
    });

    document.getElementById('btn-break').addEventListener('click', performBlockBreak);
    document.getElementById('btn-place').addEventListener('click', performBlockPlace);
}

function performBlockBreak() {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const blocks = [];
    if (activeDimension === 'overworld') {
        Object.values(loadedChunks).forEach(group => blocks.push(...group.children));
    } else if (fixedDimensionGroup) {
        blocks.push(...fixedDimensionGroup.children);
    }

    const intersects = raycaster.intersectObjects(blocks);
    if (intersects.length > 0 && intersects[0].distance < 5) {
        const hit = intersects[0].object;
        hit.parent.remove(hit);
    }
}

function performBlockPlace() {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const blocks = [];
    if (activeDimension === 'overworld') {
        Object.values(loadedChunks).forEach(group => blocks.push(...group.children));
    } else if (fixedDimensionGroup) {
        blocks.push(...fixedDimensionGroup.children);
    }

    const intersects = raycaster.intersectObjects(blocks);
    if (intersects.length > 0 && intersects[0].distance < 5) {
        const hit = intersects[0];
        const placePos = new THREE.Vector3().copy(hit.point).add(hit.face.normal.clone().multiplyScalar(0.5));
        
        const mesh = new THREE.Mesh(blockGeo, materials[activeDimension][selectedBlockType - 1] || materials[activeDimension][0]);
        mesh.position.set(Math.round(placePos.x), Math.round(placePos.y), Math.round(placePos.z));
        hit.object.parent.add(mesh);
    }
}

function setupInputEvents() {
    window.addEventListener('keydown', (e) => keys[e.code] = true);
    window.addEventListener('keyup', (e) => keys[e.code] = false);

    // 터치 시점 조종 (화면 우측 드래그)
    window.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.clientX > window.innerWidth / 2 && !touch.target.closest('#mobile-controls') && !touch.target.closest('#hud')) {
                isTouchingLook = true;
                lastTouchPos = { x: touch.clientX, y: touch.clientY };
            }
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (!isTouchingLook) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.clientX > window.innerWidth / 2) {
                const dx = touch.clientX - lastTouchPos.x;
                const dy = touch.clientY - lastTouchPos.y;

                cameraRotation.yaw -= dx * 0.004;
                cameraRotation.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraRotation.pitch - dy * 0.004));

                lastTouchPos = { x: touch.clientX, y: touch.clientY };
            }
        }
    });

    window.addEventListener('touchend', () => isTouchingLook = false);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function renderHUD() {
    const hearts = document.getElementById('hearts-container');
    const food = document.getElementById('food-container');
    hearts.innerHTML = ''; food.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        hearts.innerHTML += '<div class="heart"></div>';
        food.innerHTML += '<div class="food"></div>';
    }
}

function selectSlot(index) {
    selectedBlockType = index + 1;
    document.querySelectorAll('.slot').forEach((slot, idx) => {
        if (idx === index) slot.classList.add('selected');
        else slot.classList.remove('selected');
    });
}

function switchDimension(dim) {
    setDimensionEnvironment(dim);
    document.getElementById('menu-modal').classList.add('hidden');
}

let lastTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    updatePhysics(delta);
    renderer.render(scene, camera);
}

window.onload = init;
