const firebaseConfig = {
    apiKey: "AIzaSyALY1vj0Qp93fY0jYd3D7MFseJn24cyV9E",
    authDomain: "monitoring-hujan-27a0e.firebaseapp.com",
    projectId: "monitoring-hujan-27a0e",
    storageBucket: "monitoring-hujan-27a0e.firebasestorage.app",
    messagingSenderId: "864443661330",
    appId: "1:864443661330:web:41d987b7a412bb9fb12ccb"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
        console.log('Service Worker Registered');
    });
}

// Variables
let currentMode = 'hujan';
let timerInterval;
let myRecordDocId = localStorage.getItem('my_active_record_id');
let chartInstance = null;

// Initialization
window.onload = async () => {
    // Load saved settings
    document.getElementById('pengawas').value = localStorage.getItem('spray_pengawas') || "";
    document.getElementById('paddock').value = localStorage.getItem('spray_paddock') || "";
    document.getElementById('kegiatan').value = localStorage.getItem('spray_kegiatan') || "";
    
    await loadMasterData();
    checkRunningTimer();
    renderHistoryTable();
    setupDashboard();
    
    // Request Notification Permission
    if (Notification && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
};

// Navigation (SPA)
function switchTab(tabId) {
    document.getElementById('tracker-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('master-section').classList.add('hidden');
    
    document.getElementById(tabId + '-section').classList.remove('hidden');
    
    // Update bottom nav UI
    ['nav-tracker', 'nav-dashboard', 'nav-master'].forEach(id => {
        document.getElementById(id).classList.remove('text-blue-600');
        document.getElementById(id).classList.add('text-slate-400');
    });
    document.getElementById('nav-' + tabId).classList.add('text-blue-600');
    document.getElementById('nav-' + tabId).classList.remove('text-slate-400');
}

// Master Data Loading
async function loadMasterData() {
    const pD = await db.collection("master_paddock").get();
    const pwD = await db.collection("master_pengawas").get();
    const kD = await db.collection("master_kegiatan").get();

    populateDatalist('list_paddock', pD);
    populateDatalist('list_pengawas', pwD);
    populateDatalist('list_kegiatan', kD);

    renderMasterList('m_paddock_list', pD, 'master_paddock');
    renderMasterList('m_pengawas_list', pwD, 'master_pengawas');
    renderMasterList('m_kegiatan_list', kD, 'master_kegiatan');
}

function populateDatalist(id, snapshot) {
    const dl = document.getElementById(id);
    dl.innerHTML = "";
    snapshot.forEach(doc => {
        const option = document.createElement('option');
        option.value = doc.data().nama;
        dl.appendChild(option);
    });
}

function renderMasterList(containerId, snapshot, collectionName) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    snapshot.forEach(doc => {
        container.innerHTML += `
            <div class="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100 mb-2">
                <span class="text-xs font-bold text-slate-700">${doc.data().nama}</span>
                <div>
                    <button onclick="editMaster('${collectionName}', '${doc.id}', '${doc.data().nama}')" class="text-blue-500 font-bold text-xs p-1 mr-2">Edit</button>
                    <button onclick="deleteMaster('${collectionName}', '${doc.id}')" class="text-red-500 font-bold text-xs p-1">Hapus</button>
                </div>
            </div>
        `;
    });
}

async function addMaster(type, inputId) {
    const val = document.getElementById(inputId).value.trim();
    if (!val) return;
    await db.collection("master_" + type).add({ nama: val, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById(inputId).value = "";
    loadMasterData();
}

async function deleteMaster(collection, id) {
    if (confirm("Hapus data master ini?")) {
        await db.collection(collection).doc(id).delete();
        loadMasterData();
    }
}

async function editMaster(collection, id, currentName) {
    const newName = prompt("Edit nama:", currentName);
    if (newName !== null && newName.trim() !== "" && newName !== currentName) {
        await db.collection(collection).doc(id).update({ nama: newName.trim() });
        loadMasterData();
    }
}

// Auto Save Settings
function savePersist() {
    localStorage.setItem('spray_pengawas', document.getElementById('pengawas').value);
    localStorage.setItem('spray_paddock', document.getElementById('paddock').value);
    localStorage.setItem('spray_kegiatan', document.getElementById('kegiatan').value);
}

// Tracking Logic
function switchMode(mode) {
    if(localStorage.getItem('spray_timer_start')) return; 

    currentMode = mode;
    document.getElementById('inputHujan').classList.toggle('hidden', mode !== 'hujan');
    document.getElementById('inputAngin').classList.toggle('hidden', mode !== 'angin');
    document.getElementById('inputTunggu').classList.toggle('hidden', mode !== 'tunggu');
    
    ['mHujan','mAngin','mTunggu'].forEach(m => document.getElementById(m).classList.remove('tab-active'));
    document.getElementById('m' + mode.charAt(0).toUpperCase() + mode.slice(1)).classList.add('tab-active');
    
    const labels = { hujan: 'Hujan', angin: 'Angin Kencang', tunggu: 'Standby Lain' };
    document.getElementById('timerLabel').innerText = "Mode: " + labels[mode];
}

async function startTimer() {
    const pengawas = document.getElementById('pengawas').value;
    const paddock = document.getElementById('paddock').value;
    const kegiatan = document.getElementById('kegiatan').value;

    if (!pengawas || !paddock || !kegiatan) {
        alert("Mohon isi Pengawas, Paddock, dan Kegiatan terlebih dahulu!");
        return;
    }

    const now = Date.now();
    localStorage.setItem('spray_timer_start', now);
    localStorage.setItem('spray_timer_mode', currentMode);

    // Register to active_records
    const docRef = await db.collection("active_records").add({
        pengawas, paddock, kegiatan, mode: currentMode, startTime: now, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    myRecordDocId = docRef.id;
    localStorage.setItem('my_active_record_id', myRecordDocId);

    updateTimerUI(true);
    runTimerDisplay(now);

    sendNotification('Merekam Kendala!', 'Sedang mencatat waktu kendala...');
}

function checkRunningTimer() {
    const savedStart = localStorage.getItem('spray_timer_start');
    if(savedStart) {
        const mode = localStorage.getItem('spray_timer_mode');
        switchMode(mode);
        updateTimerUI(true);
        runTimerDisplay(parseInt(savedStart));
    }
}

function runTimerDisplay(startTime) {
    document.getElementById('startTimeLabel').innerText = "Mulai: " + new Date(startTime).toLocaleTimeString('id-ID');
    document.getElementById('formContainer').classList.add('locked'); // Lock form
    
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const diff = Date.now() - startTime;
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        document.getElementById('timerDisplay').innerText = `${h}:${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    localStorage.setItem('spray_timer_end', Date.now());
    updateTimerUI(false);
    document.getElementById('formContainer').classList.remove('locked');
    
    sendNotification('Timer Berhenti', 'Jangan lupa simpan data.');
}

function updateTimerUI(running) {
    document.getElementById('btnStart').classList.toggle('hidden', running);
    document.getElementById('btnStop').classList.toggle('hidden', !running);
    document.getElementById('btnSave').classList.toggle('opacity-50', running);
    document.getElementById('btnSave').disabled = running;
}

async function saveData() {
    const pw = document.getElementById('pengawas').value;
    const pad = document.getElementById('paddock').value;
    const kg = document.getElementById('kegiatan').value;
    const start = localStorage.getItem('spray_timer_start');
    const end = localStorage.getItem('spray_timer_end');
    
    if(!start || !end) return alert("Belum ada data timer atau belum di Stop!");

    const durasiFinal = document.getElementById('timerDisplay').innerText;
    const diffDurasiMin = Math.floor((parseInt(end) - parseInt(start)) / 60000);

    const startT = new Date(parseInt(start)).toLocaleTimeString('id-ID');
    const endT = new Date(parseInt(end)).toLocaleTimeString('id-ID');

    let detail = "";
    if(currentMode === 'hujan') detail = document.querySelector('input[name="ketHujan"]:checked')?.value || "Hujan";
    else if(currentMode === 'angin') detail = (document.getElementById('windSpeed').value || "0") + " Km/jam";
    else detail = document.getElementById('customReason').value || "Lainnya";

    await db.collection("spray_analytics_v12").add({
        pengawas: pw, paddock: pad, kegiatan: kg, durasi: durasiFinal, durasi_menit: diffDurasiMin, tipe: currentMode, keterangan: detail,
        jam_mulai: startT,
        jam_selesai: endT,
        tanggal: new Date(parseInt(start)).toLocaleDateString('id-ID'),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Remove from active_records
    if (myRecordDocId) {
        await db.collection("active_records").doc(myRecordDocId).delete();
        myRecordDocId = null;
    }

    localStorage.removeItem('spray_timer_start');
    localStorage.removeItem('spray_timer_end');
    localStorage.removeItem('my_active_record_id');
    localStorage.removeItem('spray_timer_mode');
    
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATION' });
    }

    alert("Laporan Tersimpan!");
    document.getElementById('timerDisplay').innerText = "00:00:00";
    document.getElementById('startTimeLabel').innerText = "--:--:--";
}

// Notification Helper
function sendNotification(title, body) {
    if (Notification.permission === 'granted' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            body: body
        });
    }
}

// History Table
function renderHistoryTable() {
    const tglSkrg = new Date().toLocaleDateString('id-ID');
    db.collection("spray_analytics_v12").where("tanggal", "==", tglSkrg)
      .onSnapshot(snap => {
        const tbody = document.getElementById('tableBody'); 
        tbody.innerHTML = "";
        let arr = []; 
        snap.forEach(doc => arr.push({id: doc.id, ...doc.data()}));
        arr.sort((a,b) => b.timestamp - a.timestamp);
        
        arr.forEach(d => {
            const icon = d.tipe === 'hujan' ? '🌦️' : d.tipe === 'angin' ? '💨' : '⏳';
            tbody.innerHTML += `
                <tr class="border-b border-slate-100">
                    <td class="p-2 text-[10px] font-mono leading-tight">${d.jam_mulai}<br><span class="text-rose-400">s/d</span><br>${d.jam_selesai}</td>
                    <td class="p-2 text-xs font-bold">${icon} ${d.kegiatan}<br><span class="text-[9px] text-slate-400 font-normal">Pad: ${d.paddock} | ${d.keterangan}</span></td>
                    <td class="p-2 text-center font-mono font-black text-blue-700 text-xs">${d.durasi}</td>
                    <td class="p-2 text-center"><button onclick="deleteRecord('${d.id}')" class="text-red-500 font-bold text-xs bg-red-50 rounded px-2 py-1">X</button></td>
                </tr>`;
        });
    });
}

async function deleteRecord(id) {
    if (confirm("Hapus data record ini?")) {
        await db.collection("spray_analytics_v12").doc(id).delete();
    }
}

// Dashboard Real-time
function setupDashboard() {
    // Listen to Active Records
    db.collection("active_records").onSnapshot(snap => {
        const container = document.getElementById('active-users-container');
        container.innerHTML = "";
        let activeCount = 0;
        
        snap.forEach(doc => {
            activeCount++;
            const d = doc.data();
            const elapsed = Math.floor((Date.now() - d.startTime) / 60000); // in minutes
            container.innerHTML += `
                <div class="bg-white p-3 rounded-xl border-l-4 border-emerald-500 shadow-sm flex justify-between items-center mb-2">
                    <div>
                        <p class="text-xs font-bold text-slate-800">${d.pengawas}</p>
                        <p class="text-[10px] text-slate-500">${d.kegiatan} • ${d.paddock}</p>
                    </div>
                    <div class="text-right">
                        <span class="inline-block px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full animate-pulse">RECORDING</span>
                        <p class="text-[10px] font-mono text-slate-400 mt-1">${elapsed} mnt</p>
                    </div>
                </div>
            `;
        });
        
        if(activeCount === 0) {
            container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Tidak ada record aktif saat ini.</p>`;
        }
    });

    // Render Chart
    renderChart();
}

function renderChart() {
    db.collection("spray_analytics_v12").onSnapshot(snap => {
        let arr = [];
        snap.forEach(doc => arr.push(doc.data()));
        
        // Group by Date for simplicity (Line Chart: Date vs Total Duration)
        const grouped = {};
        arr.forEach(d => {
            if(!grouped[d.tanggal]) grouped[d.tanggal] = 0;
            grouped[d.tanggal] += (d.durasi_menit || 0);
        });

        const labels = Object.keys(grouped).sort();
        const dataPoints = labels.map(l => grouped[l]);

        const ctx = document.getElementById('productivityChart').getContext('2d');
        if(chartInstance) chartInstance.destroy();
        
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Waktu Kendala (Menit)',
                    data: dataPoints,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    });
}

// Download CSV Logic
async function downloadCSV() {
    const startInput = document.getElementById('filter_start').value;
    const endInput = document.getElementById('filter_end').value;
    const pengawasInput = document.getElementById('filter_pengawas').value.trim();

    let query = db.collection("spray_analytics_v12");
    
    const snap = await query.get();
    let data = [];

    const parseDateStr = (str) => {
        const parts = str.split('/');
        if(parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
        return new Date(str); 
    };

    const startD = startInput ? new Date(startInput) : null;
    const endD = endInput ? new Date(endInput) : null;
    if(startD) startD.setHours(0,0,0,0);
    if(endD) endD.setHours(23,59,59,999);

    snap.forEach(doc => {
        const d = doc.data();
        let include = true;
        
        if (startD || endD) {
            const rowDate = parseDateStr(d.tanggal);
            if (startD && rowDate < startD) include = false;
            if (endD && rowDate > endD) include = false;
        }

        if (pengawasInput && pengawasInput !== "" && d.pengawas !== pengawasInput) {
            include = false;
        }

        if (include) {
            data.push(d);
        }
    });

    if (data.length === 0) {
        alert("Tidak ada data yang sesuai dengan filter.");
        return;
    }

    data.sort((a,b) => b.timestamp - a.timestamp);

    const headers = ["Tanggal", "Jam_Mulai", "Jam_Selesai", "Durasi", "Durasi_Menit", "Paddock", "Kegiatan", "Pengawas", "Tipe_Kendala", "Keterangan"];
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

    data.forEach(row => {
        const rowArr = [
            `"${row.tanggal}"`,
            `"${row.jam_mulai}"`,
            `"${row.jam_selesai}"`,
            `"${row.durasi}"`,
            row.durasi_menit,
            `"${row.paddock}"`,
            `"${row.kegiatan}"`,
            `"${row.pengawas}"`,
            `"${row.tipe}"`,
            `"${row.keterangan}"`
        ];
        csvContent += rowArr.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Laporan_Kendala_Spray_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
