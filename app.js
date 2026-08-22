// App State
const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwKrMZbGko7NkI1VBrLevrbeL5Xuh_r46Yzw13YAR5aRcCncnub2KylXXovOuW0iWmW/exec';

let state = {
    allEmployees: [],
    selectedEmployee: null,
    todayData: { registros_hoy: [], en_turno: [], kpis: {} },
    sheetsUrl: localStorage.getItem('control_asistencia_sheets_url') || DEFAULT_SHEETS_URL
};

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const selectedEmployeeCard = document.getElementById('selectedEmployeeCard');
const noSelectionPlaceholder = document.getElementById('noSelectionPlaceholder');
const activeEmployeeContent = document.getElementById('activeEmployeeContent');
const empName = document.getElementById('empName');
const empDni = document.getElementById('empDni');
const empEmpresaName = document.getElementById('empEmpresaName');
const empAvatar = document.getElementById('empAvatar');
const empStatusBadge = document.getElementById('empStatusBadge');
const recordNotes = document.getElementById('recordNotes');
const btnCheckIn = document.getElementById('btnCheckIn');
const btnCheckOut = document.getElementById('btnCheckOut');

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initClock();
    loadConfig();
    refreshAllData();

    // Event listeners
    searchInput.addEventListener('input', handleSearch);
    searchInput.addEventListener('focus', handleSearch);

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });

    // Auto-refresh data every 15 seconds
    setInterval(refreshAllData, 15000);
});

// Live Clock
function initClock() {
    const update = () => {
        const now = new Date();
        document.getElementById('liveClock').textContent = now.toLocaleTimeString('es-ES');
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('liveDate').textContent = now.toLocaleDateString('es-ES', options);
    };
    update();
    setInterval(update, 1000);
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    
    let bg = 'bg-slate-800 border-slate-700 text-slate-200';
    let icon = 'info';

    if (type === 'success') {
        bg = 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200';
        icon = 'check-circle-2';
    } else if (type === 'error') {
        bg = 'bg-rose-950/90 border-rose-500/50 text-rose-200';
        icon = 'alert-triangle';
    }

    toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur-md text-xs font-semibold toast-enter pointer-events-auto ${bg}`;
    toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

async function refreshAllData() {
    await loadEmployees();
    await loadTodayData();
}

// API Calls & Direct Sheets Handler
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            if (config.sheets_url) {
                state.sheetsUrl = config.sheets_url;
                localStorage.setItem('control_asistencia_sheets_url', config.sheets_url);
            }
        }
    } catch (e) {}

    if (!state.sheetsUrl) {
        state.sheetsUrl = DEFAULT_SHEETS_URL;
        localStorage.setItem('control_asistencia_sheets_url', DEFAULT_SHEETS_URL);
    }

    updateSheetsStatusBadge();
    const input = document.getElementById('sheetsUrlInput');
    if (input && state.sheetsUrl) input.value = state.sheetsUrl;
}

function updateSheetsStatusBadge() {
    const badge = document.getElementById('sheetsStatusBadge');
    if (badge) {
        badge.className = state.sheetsUrl 
            ? "w-2 h-2 rounded-full bg-emerald-400 animate-pulse" 
            : "w-2 h-2 rounded-full bg-amber-400";
    }
}

async function loadEmployees(query = '') {
    // 1. Try local API if available
    try {
        const res = await fetch(`/api/empleados${query ? '?q=' + encodeURIComponent(query) : ''}`);
        if (res.ok) {
            const data = await res.json();
            state.allEmployees = data;
            return data;
        }
    } catch (err) {}

    // 2. Fallback to Direct Google Sheets mode (GitHub Pages compatible)
    if (!state.sheetsUrl) return filterEmployeesInMemory(query);

    try {
        const res = await fetch(`${state.sheetsUrl}?action=get_personal`);
        const data = await res.json();
        if (data.status === 'success') {
            state.allEmployees = data.data.map(p => ({
                dni: String(p.dni),
                nombre: p.nombre,
                empresa: p.empresa || 'INTERNO',
                estado_hoy: 'FUERA'
            }));
            return filterEmployeesInMemory(query);
        }
    } catch (err) {
        console.error("Error cargando empleados directamente de Google Sheets:", err);
    }
    return filterEmployeesInMemory(query);
}

function filterEmployeesInMemory(query = '') {
    if (!query) return state.allEmployees;
    const q = query.toLowerCase();
    return state.allEmployees.filter(e => 
        (e.nombre && e.nombre.toLowerCase().includes(q)) || 
        (e.dni && e.dni.toLowerCase().includes(q)) || 
        (e.empresa && e.empresa.toLowerCase().includes(q))
    );
}

async function loadTodayData() {
    // 1. Try local API first
    try {
        const res = await fetch('/api/asistencia/hoy');
        if (res.ok) {
            const data = await res.json();
            state.todayData = data;
            renderKPIs(data.kpis);
            renderActiveList(data.en_turno);
            renderTable(data.registros_hoy);
            return;
        }
    } catch (err) {}

    // 2. Fallback to Direct Google Sheets mode
    if (!state.sheetsUrl) return;

    try {
        const res = await fetch(`${state.sheetsUrl}?action=get_attendance`);
        const data = await res.json();
        if (data.status === 'success') {
            const todayStr = new Date().toISOString().split('T')[0];
            const records = data.data || [];
            
            const registros_hoy = records.filter(r => r.fecha === todayStr);
            const en_turno = records.filter(r => r.estado === 'EN_TURNO');

            // Actualizar estado de empleados en memoria
            state.allEmployees.forEach(emp => {
                const activeRec = en_turno.find(r => String(r.dni) === String(emp.dni));
                if (activeRec) {
                    emp.estado_hoy = 'EN_TURNO';
                    emp.hora_ingreso_hoy = activeRec.hora_ingreso;
                } else {
                    emp.estado_hoy = 'FUERA';
                }
            });

            const uniqueTerceros = new Set(state.allEmployees.filter(e => e.empresa && e.empresa !== 'INTERNO').map(e => e.empresa)).size;

            const kpis = {
                en_turno_actual: en_turno.length,
                marcas_hoy: registros_hoy.length,
                total_personal: state.allEmployees.length,
                empresas_terceras: uniqueTerceros
            };

            state.todayData = { registros_hoy, en_turno, kpis };
            renderKPIs(kpis);
            renderActiveList(en_turno);
            renderTable(registros_hoy);
        }
    } catch (err) {
        console.error("Error leyendo asistencia desde Google Sheets:", err);
    }
}

// Search & Autocomplete
async function handleSearch(e) {
    const query = e.target.value.trim();
    if (!query) {
        searchResults.classList.add('hidden');
        return;
    }

    const results = await loadEmployees(query);
    renderSearchResults(results, query);
}

function renderSearchResults(list, query) {
    searchResults.innerHTML = '';
    searchResults.classList.remove('hidden');

    if (list.length === 0) {
        searchResults.innerHTML = `
            <div class="p-4 text-center">
                <p class="text-xs text-slate-400">No se encontró personal registrado con "${query}"</p>
                <button onclick="triggerQuickAdd('${query}')" class="mt-2 text-xs font-bold text-sky-400 hover:underline flex items-center justify-center gap-1 mx-auto">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                    <span>Registrar "${query}" como nuevo personal / tercero</span>
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    list.forEach(emp => {
        const item = document.createElement('div');
        item.className = "p-3.5 hover:bg-slate-800/80 cursor-pointer flex items-center justify-between transition-colors";
        
        const isEnTurno = emp.estado_hoy === 'EN_TURNO';
        const badgeBg = isEnTurno ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700';
        const badgeText = isEnTurno ? `🟢 En Turno (${emp.hora_ingreso_hoy || ''})` : '🔴 Fuera';

        const isThirdParty = emp.empresa && emp.empresa !== 'INTERNO';
        const empresaBadge = isThirdParty 
            ? `<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">${emp.empresa}</span>`
            : `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">Interno</span>`;

        item.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 font-bold text-xs flex items-center justify-center text-sky-400">
                    ${getInitials(emp.nombre)}
                </div>
                <div>
                    <div class="text-sm font-bold text-white">${highlightText(emp.nombre, query)}</div>
                    <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                        <span class="font-mono">DNI: ${highlightText(emp.dni, query)}</span>
                        <span>&bull;</span>
                        ${empresaBadge}
                    </div>
                </div>
            </div>
            <span class="px-2.5 py-1 rounded-xl text-[11px] font-semibold border ${badgeBg}">
                ${badgeText}
            </span>
        `;

        item.onclick = () => selectEmployee(emp);
        searchResults.appendChild(item);
    });
}

function selectEmployee(emp) {
    state.selectedEmployee = emp;
    searchResults.classList.add('hidden');
    searchInput.value = emp.nombre;

    noSelectionPlaceholder.classList.add('hidden');
    activeEmployeeContent.classList.remove('hidden');

    empName.textContent = emp.nombre;
    empDni.textContent = `DNI: ${emp.dni}`;
    empEmpresaName.textContent = emp.empresa || 'INTERNO';
    empAvatar.textContent = getInitials(emp.nombre);

    const isEnTurno = emp.estado_hoy === 'EN_TURNO';
    if (isEnTurno) {
        empStatusBadge.className = "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40";
        empStatusBadge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span> <span>EN PLANTA (DESDE ${emp.hora_ingreso_hoy || ''})</span>`;
        btnCheckIn.disabled = true;
        btnCheckOut.disabled = false;
    } else {
        empStatusBadge.className = "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 bg-slate-900 text-slate-400 border border-slate-700";
        empStatusBadge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span> <span>FUERA / LISTO PARA INGRESO</span>`;
        btnCheckIn.disabled = false;
        btnCheckOut.disabled = true;
    }
}

// Marking Actions
async function submitCheckIn() {
    if (!state.selectedEmployee) return;
    
    btnCheckIn.disabled = true;
    const notes = recordNotes.value.trim();
    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const hora_ingreso = now.toLocaleTimeString('es-ES');

    // 1. Try local API
    try {
        const res = await fetch('/api/asistencia/ingreso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni: state.selectedEmployee.dni, notas: notes })
        });
        if (res.ok) {
            playSuccessSound();
            showToast(`Ingreso registrado: ${state.selectedEmployee.nombre}`, 'success');
            recordNotes.value = '';
            await refreshAllData();
            return;
        }
    } catch (e) {}

    // 2. Direct Google Sheets fallback
    if (!state.sheetsUrl) {
        showToast('Configura la URL de Google Sheets para registrar', 'error');
        btnCheckIn.disabled = false;
        return;
    }

    try {
        await fetch(state.sheetsUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'record_attendance',
                dni: state.selectedEmployee.dni,
                nombre: state.selectedEmployee.nombre,
                empresa: state.selectedEmployee.empresa,
                fecha: fecha,
                hora_ingreso: hora_ingreso,
                estado: 'EN_TURNO',
                notas: notes
            })
        });

        playSuccessSound();
        showToast(`Ingreso registrado a Google Sheets: ${state.selectedEmployee.nombre}`, 'success');
        recordNotes.value = '';
        state.selectedEmployee.estado_hoy = 'EN_TURNO';
        state.selectedEmployee.hora_ingreso_hoy = hora_ingreso;
        selectEmployee(state.selectedEmployee);
        await refreshAllData();

    } catch (err) {
        showToast("Error al enviar registro a Google Sheets", 'error');
    } finally {
        btnCheckIn.disabled = false;
    }
}

async function submitCheckOut() {
    if (!state.selectedEmployee) return;
    
    btnCheckOut.disabled = true;
    const notes = recordNotes.value.trim();
    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const hora_salida = now.toLocaleTimeString('es-ES');

    // 1. Try local API
    try {
        const res = await fetch('/api/asistencia/salida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni: state.selectedEmployee.dni, notas: notes })
        });
        if (res.ok) {
            const data = await res.json();
            playSuccessSound();
            showToast(`Salida registrada: ${state.selectedEmployee.nombre}`, 'success');
            recordNotes.value = '';
            await refreshAllData();
            return;
        }
    } catch (e) {}

    // 2. Direct Google Sheets fallback
    if (!state.sheetsUrl) {
        showToast('Configura la URL de Google Sheets para registrar', 'error');
        btnCheckOut.disabled = false;
        return;
    }

    try {
        await fetch(state.sheetsUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'record_attendance',
                dni: state.selectedEmployee.dni,
                nombre: state.selectedEmployee.nombre,
                empresa: state.selectedEmployee.empresa,
                fecha: fecha,
                hora_salida: hora_salida,
                estado: 'COMPLETADO',
                notas: notes
            })
        });

        playSuccessSound();
        showToast(`Salida registrada a Google Sheets: ${state.selectedEmployee.nombre}`, 'success');
        recordNotes.value = '';
        state.selectedEmployee.estado_hoy = 'FUERA';
        selectEmployee(state.selectedEmployee);
        await refreshAllData();

    } catch (err) {
        showToast("Error enviando salida a Google Sheets", 'error');
    } finally {
        btnCheckOut.disabled = false;
    }
}

// Quick Add Modal Trigger from Search
function triggerQuickAdd(query) {
    searchResults.classList.add('hidden');
    openNewPersonModal();
    if (/^\d+$/.test(query)) {
        document.getElementById('newDni').value = query;
    } else {
        document.getElementById('newNombre').value = query;
    }
}

// Render Dashboard Data
function renderKPIs(kpis) {
    if (!kpis) return;
    document.getElementById('kpiEnTurno').textContent = kpis.en_turno_actual || 0;
    document.getElementById('kpiMarcasHoy').textContent = kpis.marcas_hoy || 0;
    document.getElementById('kpiTerceros').textContent = kpis.empresas_terceras || 0;
    document.getElementById('kpiTotalPersonal').textContent = kpis.total_personal || 0;
    document.getElementById('activeCountBadge').textContent = kpis.en_turno_actual || 0;
}

function renderActiveList(list) {
    const container = document.getElementById('activeList');
    container.innerHTML = '';

    if (!list || list.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
                <i data-lucide="user-check" class="w-8 h-8 opacity-40 mb-2"></i>
                <p class="text-xs font-medium">No hay personal en planta en este momento</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    list.forEach(item => {
        const div = document.createElement('div');
        div.className = "p-3 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-all";
        
        const isThirdParty = item.empresa && item.empresa !== 'INTERNO';
        const empTag = isThirdParty 
            ? `<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">${item.empresa}</span>`
            : `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">Interno</span>`;

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold text-xs flex items-center justify-center">
                    ${getInitials(item.nombre)}
                </div>
                <div>
                    <div class="text-xs font-bold text-white">${item.nombre}</div>
                    <div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400">
                        <span>Ingreso: <strong class="text-emerald-400 font-mono">${item.hora_ingreso || ''}</strong></span>
                        <span>&bull;</span>
                        ${empTag}
                    </div>
                </div>
            </div>
            <button onclick="quickMarkExit('${item.dni}')" class="px-3 py-1 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-bold transition-all flex items-center gap-1">
                <i data-lucide="log-out" class="w-3 h-3"></i>
                <span>Salida</span>
            </button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

async function quickMarkExit(dni) {
    const list = await loadEmployees(dni);
    if (list.length > 0) {
        selectEmployee(list[0]);
        submitCheckOut();
    }
}

function renderTable(list) {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-4 py-8 text-center text-slate-500">
                    No se registran marcaciones en el día de hoy.
                </td>
            </tr>
        `;
        return;
    }

    list.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/40 transition-colors";

        const isEnTurno = row.estado === 'EN_TURNO';
        const statusBadge = isEnTurno
            ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">🟢 EN TURNO</span>`
            : `<span class="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold border border-sky-500/30">✅ COMPLETADO</span>`;

        tr.innerHTML = `
            <td class="px-4 py-3 font-semibold text-white">${row.nombre}</td>
            <td class="px-4 py-3 font-mono text-slate-400">${row.dni}</td>
            <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold border border-slate-700">${row.empresa || 'INTERNO'}</span>
            </td>
            <td class="px-4 py-3 font-mono text-emerald-400 font-bold">${row.hora_ingreso || '--'}</td>
            <td class="px-4 py-3 font-mono text-amber-400 font-bold">${row.hora_salida || '--'}</td>
            <td class="px-4 py-3 font-mono text-slate-300">${row.horas_trabajadas || '--'}</td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3 text-slate-400 truncate max-w-xs">${row.notas || '--'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterHistoryTable() {
    const query = document.getElementById('filterTableInput').value.toLowerCase();
    const rows = document.querySelectorAll('#attendanceTableBody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

// Modal Handlers
function openNewPersonModal() {
    document.getElementById('newPersonModal').classList.remove('hidden');
}

function closeNewPersonModal() {
    document.getElementById('newPersonModal').classList.add('hidden');
}

async function saveNewPerson() {
    const dni = document.getElementById('newDni').value.trim();
    const nombre = document.getElementById('newNombre').value.trim();
    const empresa = document.getElementById('newEmpresa').value.trim() || 'INTERNO';

    if (!dni || !nombre) {
        showToast('Completa el DNI y el Nombre Completo', 'error');
        return;
    }

    // 1. Try local API
    try {
        const res = await fetch('/api/empleados', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni, nombre, empresa })
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Personal creado correctamente: ${nombre}`, 'success');
            closeNewPersonModal();
            selectEmployee(data);
            await refreshAllData();
            return;
        }
    } catch (e) {}

    // 2. Direct Google Sheets fallback
    if (!state.sheetsUrl) {
        showToast('Configura la URL de Google Sheets primero', 'error');
        return;
    }

    try {
        await fetch(state.sheetsUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add_personal',
                dni: dni,
                nombre: nombre,
                empresa: empresa
            })
        });

        showToast(`Personal enviado a Google Sheets: ${nombre}`, 'success');
        closeNewPersonModal();
        const newEmp = { dni, nombre, empresa, estado_hoy: 'FUERA' };
        state.allEmployees.push(newEmp);
        selectEmployee(newEmp);
        await refreshAllData();
    } catch (err) {
        showToast('Error al enviar personal a Google Sheets', 'error');
    }
}

function openSheetsModal() {
    document.getElementById('sheetsModal').classList.remove('hidden');
}

function closeSheetsModal() {
    document.getElementById('sheetsModal').classList.add('hidden');
}

async function saveSheetsConfig() {
    const url = document.getElementById('sheetsUrlInput').value.trim();
    state.sheetsUrl = url;
    localStorage.setItem('control_asistencia_sheets_url', url);

    try {
        await fetch('/api/config/sheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheets_url: url })
        });
    } catch (e) {}

    updateSheetsStatusBadge();
    showToast('Configuración de Google Sheets guardada', 'success');
    closeSheetsModal();
    refreshAllData();
}

async function syncFromSheetsNow() {
    showToast('Sincronizando datos desde Google Sheets...', 'info');
    await refreshAllData();
    showToast('Sincronización de datos completada', 'success');
}

// Helpers
function getInitials(name) {
    if (!name) return 'P';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<span class="text-sky-400 underline font-extrabold">$1</span>');
}

function playSuccessSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
}

function toggleKioskMode() {
    document.body.classList.toggle('kiosk-mode');
    showToast(document.body.classList.contains('kiosk-mode') ? 'Modo Kiosco Activado' : 'Modo Normal Activado', 'info');
}

function exportToCSV() {
    const records = state.todayData.registros_hoy || [];
    if (records.length === 0) {
        showToast('No hay datos para exportar hoy', 'error');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,DNI,Nombre,Empresa,Fecha,Hora Ingreso,Hora Salida,Horas Trabajadas,Estado,Notas\n";
    records.forEach(r => {
        csvContent += `"${r.dni}","${r.nombre}","${r.empresa || 'INTERNO'}","${r.fecha}","${r.hora_ingreso || ''}","${r.hora_salida || ''}","${r.horas_trabajadas || ''}","${r.estado}","${r.notas || ''}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `asistencia_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
