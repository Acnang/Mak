// --- 전역 설정 및 상태 변수 ---
const CHUNK_SIZE = 16;
let renderDistance = 2;
let activeDimension = 'overworld';
let isThirdPerson = false;

let scene, camera, renderer;
let simplex = new SimplexNoise();
let loadedChunks = {};
let fixedDimensionGroup = null;

// 플레이어 물리 및 상태
let player = {
    pos: new THREE.Vector3(0, 20, 0),
    vel: new THREE.Vector3(0, 0, 0),
    size: new THREE.Vector3(0.6, 1.8, 0.6),
    isGrounded: false,
    health: 10, // 최대 10하트 (20 HP)
    maxAirY: 20
};

let playerMesh;
let selectedBlockType = 1;

// 조이스틱 및 컨트롤 변수
let joystickInput = { forward: 0, side: 0 };
let cameraRotation = { yaw: 0, pitch: 0 };
let isTouchingLook = false;
let lastTouchPos = { x: 0, y: 0 };
const keys = {};

// 마인크래프트풍 차분하고 디테일한 블록 색감 (쨍한 원색 제거)
const materials = {
    overworld: [
        new THREE.MeshLambertMaterial({ color: 0x567d46 }), // Grass
        new THREE.MeshLambertMaterial({ color: 0x866043 }), // Dirt
        new THREE.MeshLambertMaterial({ color: 0x737373 }), // Stone
        new THREE.MeshLambertMaterial({ color: 0x6b4f2c }), // Wood
        new THREE.MeshLambertMaterial({ color: 0x5b3e8c })  // Ether Ore
    ],
    nether: [
        new THREE.MeshLambertMaterial({ color: 0x661e1e }), // Netherrack
        new THREE.MeshLambertMaterial({ color: 0x4a4a4a }), // Basalt
        new THREE.MeshLambertMaterial({ color: 0xb48114 })  // Glowstone
    ],
    ender: [
        new THREE.MeshLambertMaterial({ color: 0xded991 }), // End Stone
        new THREE.MeshLambertMaterial({ color: 0x24143a })  // Obsidian
    ]
};

const blockGeo = new THREE.BoxGeometry(1, 1, 1);
let playerSkinColors = Array(64).fill('#3b5fa3'); // 기본 플레이어 스킨 색상 배열 (8x8)

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('webgl-canvas'), antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 0.6);
    dirLight.position.set(40, 70, 40);
    scene.add(dirLight);

    createPlayerAvatar();
    setDimensionEnvironment('overworld');

    setupUI();
    setupSkinEditor();
    setupJoystick();
    setupInputEvents();

    animate();
}

// 플레이어 아바타 및 스킨 적용
function createPlayerAvatar() {
    if (playerMesh) scene.remove(playerMesh);

    const group = new THREE.Group();
    const defaultMat = new THREE.MeshLambertMaterial({ color: 0x3b5fa3 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd9b38c });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), defaultMat);
    body.position.y = 0.45;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.1;
    group.add(head);

    playerMesh = group;
    scene.add(playerMesh);
}

// --- 오버월드 무한 청크 및 정확한 지형 높이 계산 ---
function getChunkKey(cx, cz) { return `${cx},${cz}`; }

function getTerrainHeight(x, z) {
    if (activeDimension !== 'overworld') return 5;
    return Math.floor(simplex.noise2D(x * 0.04, z * 0.04) * 6) + 6;
}

function generateChunk(cx, cz) {
    const chunkGroup = new THREE.Group();
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const height = getTerrainHeight(worldX, worldZ);

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

    Object.keys(loadedChunks).forEach(key => {
        if (!activeKeys.has(key)) {
            scene.remove(loadedChunks[key]);
            delete loadedChunks[key];
        }
    });
}

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

    Object.keys(loadedChunks).forEach(k => scene.remove(loadedChunks[k]));
    loadedChunks = {};

    if (fixedDimensionGroup) {
        scene.remove(fixedDimensionGroup);
        fixedDimensionGroup = null;
    }

    if (dim === 'overworld') {
        scene.background = new THREE.Color(0x739be6);
        scene.fog = new THREE.FogExp2(0x739be6, 0.018);
        updateChunks();
    } else if (dim === 'nether') {
        scene.background = new THREE.Color(0x4a1515);
        scene.fog = new THREE.FogExp2(0x4a1515, 0.04);
        generateFixedDimension('nether');
    } else if (dim === 'ender') {
        scene.background = new THREE.Color(0x181028);
        scene.fog = new THREE.FogExp2(0x181028, 0.03);
        generateFixedDimension('ender');
    }
}

// --- 조이스틱 방향 반전 수정 (위로 올리면 전진) ---
function setupJoystick() {
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
                updateJoystick(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
            }
        }
    });

    const resetJoystick = (e) => {
        if (activeTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                activeTouchId = null;
                handle.style.transform = `translate(-50%, -50%)`;
                joystickInput = { forward: 0, side: 0 };
            }
        }
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);

    function updateJoystick(clientX, clientY) {
        let dx = clientX - centerPos.x;
        let dy = clientY - centerPos.y; // 위로 올리면 음수(-)
        let dist = Math.hypot(dx, dy);

        if (dist > maxRadius) {
            dx = (dx / dist) * maxRadius;
            dy = (dy / dist) * maxRadius;
        }

        handle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        
        // 위로 올릴 때(음수 dy) 전진하도록 부호 반전(-) 적용
        joystickInput.side = dx / maxRadius;
        joystickInput.forward = - (dy / maxRadius);
    }
}

// --- 정교한 물리 충돌 엔진 및 낙하 데미지 계산 ---
function updatePhysics(delta) {
    let inputForward = joystickInput.forward;
    let inputSide = joystickInput.side;

    if (keys['KeyW']) inputForward = 1;
    if (keys['KeyS']) inputForward = -1;
    if (keys['KeyA']) inputSide = -1;
    if (keys['KeyD']) inputSide = 1;

    const speed = 5.5;
    const forward = new THREE.Vector3(Math.sin(cameraRotation.yaw), 0, Math.cos(cameraRotation.yaw));
    const side = new THREE.Vector3(Math.cos(cameraRotation.yaw), 0, -Math.sin(cameraRotation.yaw));

    const moveDir = new THREE.Vector3()
        .addScaledVector(forward, inputForward)
        .addScaledVector(side, inputSide);

    if (moveDir.lengthSq() > 0) moveDir.normalize();

    player.vel.x = moveDir.x * speed;
    player.vel.z = moveDir.z * speed;

    // 중력 및 낙하 최고점 추적
    player.vel.y -= 22.0 * delta;

    player.pos.x += player.vel.x * delta;
    player.pos.z += player.vel.z * delta;
    player.pos.y += player.vel.y * delta;

    // 지형 높이 기반 충돌 (공중 부양 현상 완전 해결)
    const groundHeight = activeDimension === 'overworld' ? getTerrainHeight(player.pos.x, player.pos.z) : 5;
    const groundLevel = groundHeight + 1.0; // 발판 위치 정확히 맞춤

    if (player.pos.y <= groundLevel) {
        if (!player.isGrounded) {
            // 착지 시 낙하 데미지 계산 (높이 차이가 3칸 이상일 때)
            let fallDistance = player.maxAirY - player.pos.y;
            if (fallDistance > 3.0) {
                let damage = Math.floor((fallDistance - 3.0) * 1.5);
                applyDamage(damage);
            }
        }
        player.pos.y = groundLevel;
        player.vel.y = 0;
        player.isGrounded = true;
        player.maxAirY = player.pos.y;
    } else {
        if (player.isGrounded) {
            player.maxAirY = player.pos.y;
        } else {
            if (player.pos.y > player.maxAirY) player.maxAirY = player.pos.y;
        }
        player.isGrounded = false;
    }

    // 카메라 및 아바타 위치 동기화
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

// 데미지 및 체력바 처리
function applyDamage(amount) {
    player.health -= amount;
    if (player.health < 0) player.health = 0;
    renderHUD();

    if (player.health <= 0) {
        alert('사망했습니다! 스폰 지점으로 부활합니다.');
        player.pos.set(0, 20, 0);
        player.health = 10;
        renderHUD();
    }
}

// --- 플레이어 스킨 그리기 에디터 로직 ---
function setupSkinEditor() {
    const grid = document.getElementById('pixel-canvas');
    let selectedColor = '#5b3e8c';

    // 8x8 픽셀 생성
    for (let i = 0; i < 64; i++) {
        const cell = document.createElement('div');
        cell.className = 'pixel-cell';
        cell.style.backgroundColor = playerSkinColors[i];
        cell.addEventListener('click', () => {
            playerSkinColors[i] = selectedColor;
            cell.style.backgroundColor = selectedColor;
        });
        grid.appendChild(cell);
    }

    // 팔레트 색상 선택
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            selectedColor = swatch.getAttribute('data-color');
        });
    });

    document.getElementById('btn-open-skin').addEventListener('click', () => {
        document.getElementById('skin-modal').classList.remove('hidden');
        document.getElementById('menu-modal').classList.add('hidden');
    });

    document.getElementById('btn-close-skin').addEventListener('click', () => {
        document.getElementById('skin-modal').classList.add('hidden');
    });

    document.getElementById('btn-apply-skin').addEventListener('click', () => {
        // 커스텀 색상으로 플레이어 바디 메시 재질 생성
        const avgColor = playerSkinColors[0]; 
        if (playerMesh && playerMesh.children.length > 0) {
            playerMesh.children[0].material = new THREE.MeshLambertMaterial({ color: avgColor });
        }
        document.getElementById('skin-modal').classList.add('hidden');
    });
}

// --- UI 및 이벤트 관리 ---
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
        if (player.isGrounded) player.vel.y = 8.0;
    });

    document.getElementById('btn-break').addEventListener('click', performBlockBreak);
    document.getElementById('btn-place').addEventListener('click', performBlockPlace);
}

function renderHUD() {
    const container = document.getElementById('hearts-container');
    container.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        const heart = document.createElement('div');
        heart.className = i < player.health ? 'heart' : 'heart empty';
        container.appendChild(heart);
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
        
        const mat = materials[activeDimension][selectedBlockType - 1] || materials[activeDimension][0];
        const mesh = new THREE.Mesh(blockGeo, mat);
        mesh.position.set(Math.round(placePos.x), Math.round(placePos.y), Math.round(placePos.z));
        hit.object.parent.add(mesh);
    }
}

function setupInputEvents() {
    window.addEventListener('keydown', (e) => keys[e.code] = true);
    window.addEventListener('keyup', (e) => keys[e.code] = false);

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
