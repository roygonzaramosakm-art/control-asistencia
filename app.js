// App State
const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwKrMZbGko7NkI1VBrLevrbeL5Xuh_r46Yzw13YAR5aRcCncnub2KylXXovOuW0iWmW/exec';

let state = {
    allEmployees: [],
    allRecords: [],
    selectedEmployee: null,
    todayData: { registros_hoy: [], en_turno: [], kpis: {} },
    sheetsUrl: localStorage.getItem('control_asistencia_sheets_url') || DEFAULT_SHEETS_URL,
    customTimeMode: false,
    searchStatusFilter: 'all', // 'all', 'pending', 'registered'
    userRole: localStorage.getItem('control_asistencia_user_role') || 'guard' // Options: 'guard', 'priscila', 'roy'
};

// Obtiene la fecha actual en hora local de Perú/PC (YYYY-MM-DD) sin desfase UTC nocturno
function getTodayLocalString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Normaliza cualquier fecha de Google Sheets o input a formato YYYY-MM-DD sin desfase de zona horaria
function normalizeDateString(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
    }
    // Si viene como cadena Date de Google Sheets con 00:00:00 (ej. "Mon Nov 02 2026 00:00:00 GMT..."), extraer literal
    const monthNames = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    if (str.includes('00:00:00')) {
        const textDateMatch = str.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})\b/i);
        if (textDateMatch) {
            const mm = monthNames[textDateMatch[1].toLowerCase()];
            const dd = String(textDateMatch[2]).padStart(2, '0');
            const yyyy = textDateMatch[3];
            return `${yyyy}-${mm}-${dd}`;
        }
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        // Compensar +6 horas para evitar que medianoche GMT/EDT retroceda al día anterior en GMT-5 (Perú)
        const adjusted = new Date(d.getTime() + 6 * 3600 * 1000);
        const yyyy = adjusted.getFullYear();
        const mm = String(adjusted.getMonth() + 1).padStart(2, '0');
        const dd = String(adjusted.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return str;
}

// Busca si el empleado ya tiene un registro en una fecha específica (por DNI o por Nombre Completo)
function getEmployeeRecordForDate(dni, fechaStr, nombre = '') {
    if ((!dni && !nombre) || !fechaStr) return null;
    const cleanDni = String(dni || '').replace(/\s+/g, '').toLowerCase();
    const nameKey = nombre ? getSortedNameTokensKey(nombre) : '';
    const targetDate = normalizeDateString(fechaStr);
    const records = state.allRecords && state.allRecords.length > 0
        ? state.allRecords
        : (state.todayData.registros_hoy || []);
    // Coincidir por DNI o por Nombre en la misma fecha
    const matches = records.filter(r => {
        const recDate = normalizeDateString(r.fecha);
        if (recDate !== targetDate) return false;
        const rDni = String(r.dni || '').replace(/\s+/g, '').toLowerCase();
        const rNameKey = r.nombre ? getSortedNameTokensKey(r.nombre) : '';
        const sameDni = cleanDni && rDni === cleanDni;
        const sameName = nameKey && rNameKey && rNameKey === nameKey;
        return sameDni || sameName;
    });
    if (matches.length === 0) return null;
    return matches[matches.length - 1];
}

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

// Helper to clean time strings from Google Sheets (e.g. Sat Dec 30 1899 17:33:50 GMT -> 17:33:50)
function cleanTimeString(str) {
    if (!str) return '';
    str = String(str).trim();
    if (str.includes('GMT') || str.includes('1899') || str.includes('T')) {
        const match = str.match(/\d{1,2}:\d{2}:\d{2}/);
        if (match) return match[0];
        const matchShort = str.match(/\d{1,2}:\d{2}/);
        if (matchShort) return matchShort[0];
    }
    return str;
}

function getUserEmail() {
    const role = state.userRole || localStorage.getItem('control_asistencia_user_role') || 'guard';
    if (role === 'roy') return 'roy.gonza.ramos.akm@gmail.com';
    if (role === 'priscila') return 'priscilaarca.akm@gmail.com';
    return 'akmseguridad@gmail.com';
}

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initClock();
    loadConfig();
    updateUserRoleUI();
    refreshAllData();

    // Event listeners: INSTANT zero-delay search
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('focus', handleSearch);
    }

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('hidden');
            searchResults.style.display = 'none';
        }
    });

    // Preset current time in time inputs
    const nowStr = new Date().toTimeString().slice(0, 5);
    const customTimeInput = document.getElementById('customTimeInput');
    const batchTimeInput = document.getElementById('batchTimeInput');
    if (customTimeInput) customTimeInput.value = nowStr;
    if (batchTimeInput) batchTimeInput.value = nowStr;

    // Auto-refresh data every 30 seconds in background
    setInterval(refreshAllData, 30000);
});

// Role & Permission Management
function setUserRole(role) {
    state.userRole = role;
    localStorage.setItem('control_asistencia_user_role', role);
    updateUserRoleUI();
    closeRoleModal();

    if (role === 'roy') {
        showToast('Iniciado como Master Admin (roy.gonza.ramos.akm@gmail.com)', 'success');
    } else if (role === 'priscila') {
        showToast('Iniciado como Encargada GPS (priscilaarca.akm@gmail.com)', 'success');
    } else {
        showToast('Iniciado como Seguridad (akmseguridad@gmail.com)', 'info');
    }
}

function updateUserRoleUI() {
    const label = document.getElementById('currentUserLabel');
    const permissionBlock = document.getElementById('manualTimePermissionBlock');

    if (state.userRole === 'roy') {
        if (label) label.textContent = 'roy.gonza.ramos.akm@gmail.com (Master)';
        if (permissionBlock) permissionBlock.classList.remove('hidden');
    } else if (state.userRole === 'priscila') {
        if (label) label.textContent = 'priscilaarca.akm@gmail.com (GPS)';
        if (permissionBlock) permissionBlock.classList.remove('hidden');
    } else {
        if (label) label.textContent = 'akmseguridad@gmail.com (Garita)';
        if (permissionBlock) permissionBlock.classList.add('hidden');
        
        // Reset custom time mode if guard is active
        const toggle = document.getElementById('useCustomTimeToggle');
        if (toggle && toggle.checked) {
            toggle.checked = false;
            toggleCustomTimeMode();
        }
    }
}

function openRoleModal() {
    document.getElementById('roleModal').classList.remove('hidden');
}

function closeRoleModal() {
    document.getElementById('roleModal').classList.add('hidden');
}

function openManualModal() {
    document.getElementById('manualModal').classList.remove('hidden');
}

function closeManualModal() {
    document.getElementById('manualModal').classList.add('hidden');
}

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
    }, 4500);
}

function toggleCustomTimeMode() {
    const toggle = document.getElementById('useCustomTimeToggle');
    const currentDisplay = document.getElementById('currentTimeDisplay');
    const customContainer = document.getElementById('customTimeInputContainer');
    const customInput = document.getElementById('customTimeInput');
    const customDateInput = document.getElementById('customDateInput');

    state.customTimeMode = toggle.checked;
    if (toggle.checked) {
        currentDisplay.classList.add('hidden');
        customContainer.classList.remove('hidden');
        if (customInput && !customInput.value) {
            customInput.value = new Date().toTimeString().slice(0, 5);
        }
        if (customDateInput && !customDateInput.value) {
            customDateInput.value = new Date().toISOString().split('T')[0];
        }
    } else {
        currentDisplay.classList.remove('hidden');
        customContainer.classList.add('hidden');
    }

    if (state.selectedEmployee) {
        selectEmployee(state.selectedEmployee);
    }
    lucide.createIcons();
}

function getSelectedTime() {
    const toggle = document.getElementById('useCustomTimeToggle');
    const customInput = document.getElementById('customTimeInput');
    
    if (state.userRole !== 'guard' && toggle && toggle.checked && customInput && customInput.value) {
        return customInput.value.length === 5 ? customInput.value + ':00' : customInput.value;
    }
    return new Date().toLocaleTimeString('es-ES');
}

function getSelectedDate() {
    const toggle = document.getElementById('useCustomTimeToggle');
    const customDateInput = document.getElementById('customDateInput');
    if (state.userRole !== 'guard' && toggle && toggle.checked && customDateInput && customDateInput.value) {
        return customDateInput.value;
    }
    return new Date().toISOString().split('T')[0];
}

function calculateDurationHHMMSS(horaIngreso, horaSalida) {
    if (!horaIngreso || !horaSalida) return '';
    const parseSec = (str) => {
        const m = String(str).trim().match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
        if (!m) return 0;
        return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3] || 0, 10);
    };
    let diff = parseSec(horaSalida) - parseSec(horaIngreso);
    if (diff < 0) diff += 24 * 3600;
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = Math.floor(diff % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
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

// Normaliza texto (sin tildes, minúsculas, espacios colapsados)
function normalizePersonText(str) {
    if (!str) return '';
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Clave de palabras ordenadas (detecta "Joel Salcedo Marcas" === "Salcedo Marcas Joel")
function getSortedNameTokensKey(str) {
    const norm = normalizePersonText(str);
    if (!norm) return '';
    return norm.split(' ').filter(Boolean).sort().join(' ');
}

// Deduplica la lista de empleados en memoria (por DNI o por Nombre idéntico)
function deduplicateEmployeeList(rawList) {
    const seenDnis = new Set();
    const seenNames = new Set();
    const unique = [];

    (rawList || []).forEach(p => {
        const dniClean = String(p.dni || '').replace(/\s+/g, '').trim().toLowerCase();
        const nameKey = getSortedNameTokensKey(p.nombre);
        if (!dniClean && !nameKey) return;
        if (dniClean && seenDnis.has(dniClean)) return;
        if (nameKey && seenNames.has(nameKey)) return;

        if (dniClean) seenDnis.add(dniClean);
        if (nameKey) seenNames.add(nameKey);

        unique.push({
            dni: String(p.dni).trim(),
            nombre: String(p.nombre).trim(),
            empresa: (p.empresa || 'INTERNO').trim(),
            estado_hoy: p.estado_hoy || 'FUERA'
        });
    });

    return unique;
}

// Carga inicial y almacenamiento en memoria (sin duplicados)
async function loadEmployees() {
    try {
        const res = await fetch('/api/empleados');
        if (res.ok) {
            const data = await res.json();
            state.allEmployees = deduplicateEmployeeList(data);
            return state.allEmployees;
        }
    } catch (err) {}

    if (!state.sheetsUrl) return state.allEmployees;

    try {
        const res = await fetch(`${state.sheetsUrl}?action=get_personal`);
        const data = await res.json();
        if (data.status === 'success') {
            state.allEmployees = deduplicateEmployeeList(data.data);
        }
    } catch (err) {
        console.error("Error cargando empleados de Google Sheets:", err);
    }
    return state.allEmployees;
}

// Búsqueda ultra-rápida en memoria (insensible a tildes)
function filterEmployeesInMemory(query = '') {
    if (!query) return state.allEmployees;
    
    const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const q = normalize(query.trim());

    return state.allEmployees.filter(e => {
        const nameMatch = e.nombre && normalize(e.nombre).includes(q);
        const dniMatch = e.dni && normalize(e.dni).includes(q);
        const empresaMatch = e.empresa && normalize(e.empresa).includes(q);
        return nameMatch || dniMatch || empresaMatch;
    });
}

async function loadTodayData() {
    const todayStr = new Date().toISOString().split('T')[0];
    const filterDateInput = document.getElementById('filterTableDateInput');
    if (filterDateInput && !filterDateInput.dataset.initialized) {
        filterDateInput.value = todayStr;
        filterDateInput.dataset.initialized = 'true';
    }

    try {
        const res = await fetch('/api/asistencia/hoy');
        if (res.ok) {
            const data = await res.json();
            state.todayData = data;
            state.allRecords = (data.registros_hoy || []).map(r => ({
                ...r,
                fecha: normalizeDateString(r.fecha || todayStr)
            }));
            renderKPIs(data.kpis);
            renderActiveList(data.en_turno);
            applyTableFilters();
            if (state.selectedEmployee) selectEmployee(state.selectedEmployee);
            return;
        }
    } catch (err) {}

    if (!state.sheetsUrl) return;

    try {
        const res = await fetch(`${state.sheetsUrl}?action=get_attendance`);
        const data = await res.json();
        if (data.status === 'success') {
            const records = (data.data || []).map(r => ({
                ...r,
                fecha: normalizeDateString(r.fecha),
                hora_ingreso: cleanTimeString(r.hora_ingreso),
                hora_salida: cleanTimeString(r.hora_salida)
            }));

            state.allRecords = records;
            
            const registros_hoy = records.filter(r => r.fecha === todayStr);
            const en_turno = records.filter(r => r.estado === 'EN_TURNO');

            // Actualizar estado de empleados en memoria
            state.allEmployees.forEach(emp => {
                const activeRec = en_turno.find(r => String(r.dni).trim() === String(emp.dni).trim());
                const todayRec = registros_hoy.find(r => String(r.dni).trim() === String(emp.dni).trim());
                if (activeRec) {
                    emp.estado_hoy = 'EN_TURNO';
                    emp.hora_ingreso_hoy = cleanTimeString(activeRec.hora_ingreso);
                } else if (todayRec && todayRec.estado === 'COMPLETADO') {
                    emp.estado_hoy = 'COMPLETADO_HOY';
                    emp.hora_ingreso_hoy = cleanTimeString(todayRec.hora_ingreso);
                    emp.hora_salida_hoy = cleanTimeString(todayRec.hora_salida);
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
            applyTableFilters();
            if (state.selectedEmployee) selectEmployee(state.selectedEmployee);
        }
    } catch (err) {
        console.error("Error leyendo asistencia desde Google Sheets:", err);
    }
}

// Filtro de estado en el buscador principal (Todos / Sin Registro en Fecha / Ya Registrados)
function setSearchStatusFilter(mode) {
    state.searchStatusFilter = mode;
    const btnAll = document.getElementById('searchFilterAll');
    const btnPending = document.getElementById('searchFilterPending');
    const btnRegistered = document.getElementById('searchFilterRegistered');

    const activeClass = "px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold transition-all";
    const inactiveClass = "px-2.5 py-1 rounded-lg text-slate-400 hover:text-white font-semibold transition-all";

    if (btnAll) btnAll.className = mode === 'all' ? activeClass : inactiveClass;
    if (btnPending) btnPending.className = mode === 'pending' ? activeClass : inactiveClass;
    if (btnRegistered) btnRegistered.className = mode === 'registered' ? activeClass : inactiveClass;

    const query = searchInput ? searchInput.value.trim() : '';
    const results = filterEmployeesInMemory(query);
    renderSearchResults(results, query);
}

// Al cambiar la fecha manual, actualizar validación anti-duplicidad del empleado seleccionado y la tabla
function onCustomDateChange() {
    const customDateInput = document.getElementById('customDateInput');
    const filterDateInput = document.getElementById('filterTableDateInput');
    if (customDateInput && customDateInput.value && filterDateInput) {
        filterDateInput.value = customDateInput.value;
        applyTableFilters();
    }
    if (state.selectedEmployee) {
        selectEmployee(state.selectedEmployee);
    }
}

// Búsqueda instantánea en vivo
function handleSearch(e) {
    const query = e.target ? e.target.value.trim() : (searchInput ? searchInput.value.trim() : '');
    const clearBtn = document.getElementById('btnClearSearch');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !query);
    }

    if (!query && state.searchStatusFilter === 'all') {
        searchResults.classList.add('hidden');
        searchResults.style.display = 'none';
        return;
    }

    const results = filterEmployeesInMemory(query);
    renderSearchResults(results, query);
}

function clearSearch() {
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    const clearBtn = document.getElementById('btnClearSearch');
    if (clearBtn) clearBtn.classList.add('hidden');
    searchResults.classList.add('hidden');
    searchResults.style.display = 'none';
    searchResults.innerHTML = '';
}

function renderSearchResults(list, query) {
    searchResults.innerHTML = '';
    const targetDate = getSelectedDate();

    // Aplicar filtro de estado en la fecha seleccionada (Todos / Sin Registro / Ya Registrados)
    const filteredList = list.filter(emp => {
        const rec = getEmployeeRecordForDate(emp.dni, targetDate);
        if (state.searchStatusFilter === 'pending') return !rec;
        if (state.searchStatusFilter === 'registered') return Boolean(rec);
        return true;
    });

    if (filteredList.length === 0) {
        searchResults.style.display = 'block';
        searchResults.classList.remove('hidden');
        searchResults.innerHTML = `
            <div class="p-4 text-center">
                <p class="text-xs text-slate-400">No se encontró personal con ese filtro para la fecha ${targetDate}</p>
                ${query ? `
                <button onclick="triggerQuickAdd('${query}')" class="mt-2 text-xs font-bold text-sky-400 hover:underline flex items-center justify-center gap-1 mx-auto">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                    <span>Registrar "${query}" como nuevo personal / tercero</span>
                </button>` : ''}
            </div>
        `;
        lucide.createIcons();
        return;
    }

    searchResults.style.display = 'block';
    searchResults.classList.remove('hidden');

    filteredList.forEach(emp => {
        const item = document.createElement('div');
        item.className = "p-3.5 hover:bg-sky-950/80 cursor-pointer flex items-center justify-between transition-colors bg-slate-950 border-b border-slate-800/60";
        
        const recOnDate = getEmployeeRecordForDate(emp.dni, targetDate);
        let badgeBg = 'bg-slate-800 text-slate-400 border-slate-700';
        let badgeText = '🔴 Sin Registro';

        if (recOnDate) {
            const cleanIn = cleanTimeString(recOnDate.hora_ingreso);
            const cleanOut = cleanTimeString(recOnDate.hora_salida);
            if (recOnDate.estado === 'EN_TURNO') {
                badgeBg = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
                badgeText = `🟢 En Turno (${cleanIn})`;
            } else {
                badgeBg = 'bg-sky-500/20 text-sky-300 border-sky-500/40';
                badgeText = `✅ Ya Registrado (${cleanIn}${cleanOut ? ' - ' + cleanOut : ''})`;
            }
        }

        const isThirdParty = emp.empresa && emp.empresa !== 'INTERNO';
        const empresaBadge = isThirdParty 
            ? `<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">${emp.empresa}</span>`
            : `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">Interno</span>`;

        item.innerHTML = `
            <div class="flex items-center gap-3 pointer-events-none">
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
            <span class="px-2.5 py-1 rounded-xl text-[11px] font-semibold border ${badgeBg} pointer-events-none">
                ${badgeText}
            </span>
        `;

        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectEmployee(emp);
        });

        searchResults.appendChild(item);
    });
}

function selectEmployee(emp) {
    state.selectedEmployee = emp;
    
    // Cierra el menú desplegable de inmediato e incondicionalmente
    searchResults.classList.add('hidden');
    searchResults.style.display = 'none';
    searchResults.innerHTML = '';
    
    const clearBtn = document.getElementById('btnClearSearch');
    if (clearBtn) clearBtn.classList.remove('hidden');

    if (searchInput) {
        searchInput.value = emp.nombre;
        searchInput.blur();
    }

    noSelectionPlaceholder.classList.add('hidden');
    activeEmployeeContent.classList.remove('hidden');

    empName.textContent = emp.nombre;
    empDni.textContent = `DNI: ${emp.dni}`;
    empEmpresaName.textContent = emp.empresa || 'INTERNO';
    empAvatar.textContent = getInitials(emp.nombre);

    const targetDate = getSelectedDate();
    const recOnDate = getEmployeeRecordForDate(emp.dni, targetDate, emp.nombre);

    const doubleAlert = document.getElementById('doubleRegistrationAlert');
    const doubleAlertText = document.getElementById('doubleRegAlertText');
    const btnCompleteShift = document.getElementById('btnSubmitCompleteManualShift');

    if (recOnDate && recOnDate.estado === 'EN_TURNO') {
        const cleanIn = cleanTimeString(recOnDate.hora_ingreso);
        empStatusBadge.className = "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40";
        empStatusBadge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span> <span>EN TURNO (${targetDate} DESDE ${cleanIn})</span>`;
        
        // Bloquear Ingreso duplicado y permitir Salida
        btnCheckIn.disabled = true;
        btnCheckOut.disabled = false;
        if (btnCompleteShift) btnCompleteShift.disabled = true;

        if (doubleAlert && doubleAlertText) {
            doubleAlertText.textContent = `⚠️ Esta persona ya tiene un Ingreso registrado en la fecha ${targetDate} a las ${cleanIn} y está EN TURNO. Solo puede marcar SALIDA.`;
            doubleAlert.classList.remove('hidden');
        }
    } else if (recOnDate && recOnDate.estado === 'COMPLETADO') {
        const cleanIn = cleanTimeString(recOnDate.hora_ingreso);
        const cleanOut = cleanTimeString(recOnDate.hora_salida);
        empStatusBadge.className = "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 bg-sky-950/80 text-sky-300 border border-sky-500/40";
        empStatusBadge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span> <span>✅ YA REGISTRADO (${targetDate})</span>`;

        // Bloquear para evitar duplicidad en la misma fecha
        btnCheckIn.disabled = true;
        btnCheckOut.disabled = true;
        if (btnCompleteShift) btnCompleteShift.disabled = true;

        if (doubleAlert && doubleAlertText) {
            doubleAlertText.textContent = `🚫 ANTI-DUPLICIDAD: ${emp.nombre} YA FUE REGISTRADO en la fecha ${targetDate} (Ingreso: ${cleanIn} | Salida: ${cleanOut} | Estado: COMPLETADO).`;
            doubleAlert.classList.remove('hidden');
        }
    } else {
        empStatusBadge.className = "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 bg-slate-900 text-slate-400 border border-slate-700";
        empStatusBadge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span> <span>SIN REGISTRO EN ${targetDate} / LISTO</span>`;
        
        btnCheckIn.disabled = false;
        btnCheckOut.disabled = !state.customTimeMode;
        if (btnCompleteShift) btnCompleteShift.disabled = false;

        if (doubleAlert) doubleAlert.classList.add('hidden');
    }
}

// Marking Actions with Anti-Double Registration Guard, Custom Date/Time & User Account Tracking
async function submitCheckIn() {
    if (!state.selectedEmployee) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const fecha = getSelectedDate();
    const exitInput = document.getElementById('customExitTimeInput');

    // Verificar duplicidad en la fecha seleccionada (tanto hoy como en regularización de fechas pasadas)
    if (!state.allRecords || state.allRecords.length === 0) {
        await loadTodayData();
    }
    const existingRec = getEmployeeRecordForDate(state.selectedEmployee.dni, fecha, state.selectedEmployee.nombre);
    if (existingRec) {
        showDuplicateBlockedModal([{ emp: state.selectedEmployee, fecha: fecha, existingRec: existingRec }], 0);
        selectEmployee(state.selectedEmployee);
        return;
    }

    // Si en modo manual también llenó la Hora de Salida, registrar el turno completo directamente
    if (state.customTimeMode && state.userRole !== 'guard' && exitInput && exitInput.value) {
        await submitCompleteManualShift();
        return;
    }
    
    btnCheckIn.disabled = true;
    const notes = recordNotes.value.trim();
    const hora_ingreso = getSelectedTime();
    const userEmail = getUserEmail();

    // 1. Try local API
    try {
        const res = await fetch('/api/asistencia/ingreso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni: state.selectedEmployee.dni, fecha: fecha, notas: notes, hora_ingreso: hora_ingreso, registrado_por: userEmail })
        });
        if (res.ok) {
            playSuccessSound();
            showToast(`Ingreso registrado (${fecha} ${hora_ingreso}): ${state.selectedEmployee.nombre}`, 'success');
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
                notas: notes,
                registrado_por: userEmail
            })
        });

        playSuccessSound();
        showToast(`Ingreso registrado (${fecha} - ${hora_ingreso}) por ${userEmail}`, 'success');
        recordNotes.value = '';
        // Registrar inmediatamente en memoria para bloquear doble clic en la misma fecha
        state.allRecords.push({
            dni: state.selectedEmployee.dni,
            nombre: state.selectedEmployee.nombre,
            empresa: state.selectedEmployee.empresa,
            fecha: normalizeDateString(fecha),
            hora_ingreso: hora_ingreso,
            hora_salida: '',
            estado: 'EN_TURNO',
            notas: notes,
            registrado_por: userEmail
        });
        if (fecha === todayStr) {
            state.selectedEmployee.estado_hoy = 'EN_TURNO';
            state.selectedEmployee.hora_ingreso_hoy = hora_ingreso;
        }
        selectEmployee(state.selectedEmployee);
        await refreshAllData();

    } catch (err) {
        showToast("Error al enviar registro a Google Sheets", 'error');
    } finally {
        btnCheckIn.disabled = false;
    }
}

// Registrar un turno completo (Fecha + Hora Ingreso + Hora Salida) de un solo paso
async function submitCompleteManualShift() {
    if (!state.selectedEmployee) {
        showToast('Selecciona primero a un personal en el buscador', 'error');
        return;
    }

    const customDateInput = document.getElementById('customDateInput');
    const customTimeInput = document.getElementById('customTimeInput');
    const customExitTimeInput = document.getElementById('customExitTimeInput');

    const fecha = (customDateInput && customDateInput.value) ? customDateInput.value : new Date().toISOString().split('T')[0];
    const rawIngreso = customTimeInput ? customTimeInput.value : '';
    const rawSalida = customExitTimeInput ? customExitTimeInput.value : '';

    // Prevención de duplicidad en la misma fecha
    if (!state.allRecords || state.allRecords.length === 0) {
        await loadTodayData();
    }
    const existingRec = getEmployeeRecordForDate(state.selectedEmployee.dni, fecha, state.selectedEmployee.nombre);
    if (existingRec) {
        showDuplicateBlockedModal([{ emp: state.selectedEmployee, fecha: fecha, existingRec: existingRec }], 0);
        selectEmployee(state.selectedEmployee);
        return;
    }

    if (!rawIngreso || !rawSalida) {
        showToast('Ingresa tanto la Hora de Ingreso como la Hora de Salida para registrar el turno completo', 'error');
        return;
    }

    const hora_ingreso = rawIngreso.length === 5 ? rawIngreso + ':00' : rawIngreso;
    const hora_salida = rawSalida.length === 5 ? rawSalida + ':00' : rawSalida;
    const horas_trabajadas = calculateDurationHHMMSS(hora_ingreso, hora_salida);
    const notes = (recordNotes.value.trim() || 'Regularización manual de turno completo');
    const userEmail = getUserEmail();

    if (!state.sheetsUrl) {
        showToast('Configura la URL de Google Sheets para registrar', 'error');
        return;
    }

    btnCheckIn.disabled = true;
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
                hora_salida: hora_salida,
                horas_trabajadas: horas_trabajadas,
                estado: 'COMPLETADO',
                notas: notes,
                registrado_por: userEmail
            })
        });

        playSuccessSound();
        showToast(`Turno completo registrado (${fecha}: ${hora_ingreso} a ${hora_salida} = ${horas_trabajadas})`, 'success');
        recordNotes.value = '';
        if (customExitTimeInput) customExitTimeInput.value = '';
        await refreshAllData();
    } catch (err) {
        showToast('Error al registrar turno completo en Google Sheets', 'error');
    } finally {
        btnCheckIn.disabled = false;
    }
}

let pendingExitTimeOverride = null;

function closeConfirmExitModal() {
    const modal = document.getElementById('confirmExitModal');
    if (modal) modal.classList.add('hidden');
    pendingExitTimeOverride = null;
}

function executeConfirmedCheckOut() {
    const customInput = document.getElementById('modalCustomTimeInput');
    if (customInput && customInput.value && state.userRole !== 'guard') {
        pendingExitTimeOverride = customInput.value + ':00';
    }
    closeConfirmExitModal();
    submitCheckOut(true);
}

async function submitCheckOut(forceConfirm = false) {
    if (!state.selectedEmployee) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const fecha = getSelectedDate();

    if (state.selectedEmployee.estado_hoy === 'FUERA' && !state.customTimeMode && fecha === todayStr) {
        showToast(`⚠️ Esta persona está FUERA de planta. Debe ingresar primero`, 'error');
        return;
    }

    const emp = state.selectedEmployee;
    const now = new Date();

    // Calcular tiempo transcurrido desde el Ingreso
    let elapsedSeconds = 0;
    if (emp.hora_ingreso_hoy) {
        const cleanIngreso = cleanTimeString(emp.hora_ingreso_hoy);
        const match = cleanIngreso.match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
        if (match) {
            const h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const s = parseInt(match[3] || 0, 10);
            const ingresoSec = h * 3600 + m * 60 + s;
            const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            elapsedSeconds = nowSec - ingresoSec;
            if (elapsedSeconds < 0) elapsedSeconds += 24 * 3600;
        }
    }

    // Verificar si ya completó un turno previo hoy
    const previousTodayShift = (state.todayData.registros_hoy || []).some(r => 
        String(r.dni).trim() === String(emp.dni).trim() && r.estado === 'COMPLETADO'
    );

    const isShortShift = elapsedSeconds > 0 && elapsedSeconds < 1800 && !state.customTimeMode; // Menos de 30 minutos

    // Si es un turno corto o reingreso en el mismo día, solicitar confirmación explícita
    if (!forceConfirm && !state.customTimeMode && (isShortShift || previousTodayShift)) {
        const modal = document.getElementById('confirmExitModal');
        const empNameElem = document.getElementById('confirmExitEmpName');
        const ingresoTimeElem = document.getElementById('confirmExitIngresoTime');
        const elapsedTimeElem = document.getElementById('confirmExitElapsedTime');
        const warningBanner = document.getElementById('confirmExitWarningBanner');
        const warningText = document.getElementById('confirmExitWarningText');
        const masterContainer = document.getElementById('modalMasterOverrideContainer');
        const customInput = document.getElementById('modalCustomTimeInput');

        if (empNameElem) empNameElem.textContent = emp.nombre;
        if (ingresoTimeElem) ingresoTimeElem.textContent = cleanTimeString(emp.hora_ingreso_hoy) || '--';

        const h = Math.floor(elapsedSeconds / 3600);
        const m = Math.floor((elapsedSeconds % 3600) / 60);
        const s = Math.floor(elapsedSeconds % 60);
        if (elapsedTimeElem) elapsedTimeElem.textContent = `${h}h ${m}m ${s}s`;

        let warningMsg = '';
        if (isShortShift && previousTodayShift) {
            warningMsg = `<p class="font-bold text-amber-300">⚠️ Turno muy corto y Reingreso en el mismo día</p>
                          <p class="text-[11px] text-amber-200/90">Esta persona sólo lleva ${m} min y ${s} seg en turno, y ya registró una asistencia previa hoy. Verifica con garita antes de confirmar.</p>`;
        } else if (isShortShift) {
            warningMsg = `<p class="font-bold text-amber-300">⚠️ Turno muy corto (menos de 30 minutos)</p>
                          <p class="text-[11px] text-amber-200/90">Esta persona sólo lleva ${m} min y ${s} seg en turno. Si fue un error de garita, puedes cancelar la marcación o ajustar la hora real.</p>`;
        } else if (previousTodayShift) {
            warningMsg = `<p class="font-bold text-amber-300">ℹ️ Segundo turno del día</p>
                          <p class="text-[11px] text-amber-200/90">Esta persona ya registra un turno completado el día de hoy.</p>`;
        }

        if (warningText) warningText.innerHTML = warningMsg;

        if (state.userRole !== 'guard') {
            if (masterContainer) masterContainer.classList.remove('hidden');
            if (customInput) customInput.value = now.toTimeString().slice(0, 5);
        } else {
            if (masterContainer) masterContainer.classList.add('hidden');
        }

        if (modal) modal.classList.remove('hidden');
        return;
    }
    
    btnCheckOut.disabled = true;
    const notes = recordNotes.value.trim();
    const hora_salida = pendingExitTimeOverride || getSelectedTime();
    const userEmail = getUserEmail();
    pendingExitTimeOverride = null;

    // 1. Try local API
    try {
        const res = await fetch('/api/asistencia/salida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni: state.selectedEmployee.dni, fecha: fecha, notas: notes, hora_salida: hora_salida, registrado_por: userEmail })
        });
        if (res.ok) {
            const data = await res.json();
            playSuccessSound();
            showToast(`Salida registrada (${fecha} ${hora_salida}): ${state.selectedEmployee.nombre}`, 'success');
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
                notas: notes,
                registrado_por: userEmail
            })
        });

        playSuccessSound();
        showToast(`Salida registrada (${fecha} - ${hora_salida}) por ${userEmail}`, 'success');
        recordNotes.value = '';
        if (fecha === todayStr) {
            state.selectedEmployee.estado_hoy = 'FUERA';
        }
        selectEmployee(state.selectedEmployee);
        await refreshAllData();

    } catch (err) {
        showToast("Error enviando salida a Google Sheets", 'error');
    } finally {
        btnCheckOut.disabled = false;
    }
}

// Cuadro de Mensaje Modal cuando un personal ya se encuentra registrado en esa fecha
function playErrorSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, ctx.currentTime);
        osc.frequency.setValueAtTime(180, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
}

function showDuplicateBlockedModal(blockedItems, registeredCount = 0) {
    const modal = document.getElementById('duplicateBlockedModal');
    const mainMsg = document.getElementById('duplicateBlockedMainMessage');
    const listContainer = document.getElementById('duplicateBlockedList');

    playErrorSound();

    if (!modal || !listContainer) {
        const names = (blockedItems || []).map(b => `${b.emp.nombre} (${b.fecha})`).join(', ');
        showToast(`🚫 No se puede registrar porque ya se encuentra registrado: ${names}`, 'error');
        return;
    }

    if (mainMsg) {
        if (registeredCount > 0) {
            mainMsg.innerHTML = `Se guardaron <strong>${registeredCount}</strong> registro(s) nuevos, pero el siguiente personal <strong>NO se puede registrar porque ya se encuentra registrado</strong> en esa fecha:`;
        } else {
            mainMsg.innerHTML = `<strong>No se puede registrar</strong> porque el personal ingresado <strong>ya se encuentra registrado</strong> en la fecha seleccionada:`;
        }
    }

    listContainer.innerHTML = (blockedItems || []).map(item => {
        const emp = item.emp || {};
        const rec = item.existingRec || {};
        const cleanIn = cleanTimeString(rec.hora_ingreso) || '--';
        const cleanOut = cleanTimeString(rec.hora_salida);
        const statusText = rec.estado === 'EN_TURNO' ? '🟢 EN TURNO' : '✅ COMPLETADO';
        return `
            <div class="p-3 rounded-2xl bg-slate-950 border border-rose-500/40 flex flex-col gap-1">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-bold text-white text-xs">${emp.nombre || 'Personal'}</span>
                    <span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/30">Ya Registrado</span>
                </div>
                <div class="text-[11px] text-slate-300 font-mono">
                    DNI: <strong>${emp.dni || '--'}</strong> &bull; Fecha: <strong class="text-amber-300">${item.fecha}</strong>
                </div>
                <div class="text-[11px] text-emerald-300 font-mono">
                    Ingreso: <strong>${cleanIn}</strong> ${cleanOut ? `| Salida: <strong class="text-amber-300">${cleanOut}</strong>` : ''} &bull; <span>${statusText}</span>
                </div>
            </div>
        `;
    }).join('');

    modal.classList.remove('hidden');
    lucide.createIcons();
}

function closeDuplicateBlockedModal() {
    const modal = document.getElementById('duplicateBlockedModal');
    if (modal) modal.classList.add('hidden');
}

// Carga Masiva y Regularización por Días con Filtro Anti-Duplicidad
let selectedBatchDnis = new Set();

function getBatchSelectedDate() {
    const dateInput = document.getElementById('batchDateInput');
    return (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
}

function openBatchModal() {
    document.getElementById('batchModal').classList.remove('hidden');
    const dateInput = document.getElementById('batchDateInput');
    const timeInput = document.getElementById('batchTimeInput');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
    if (timeInput && !timeInput.value) {
        timeInput.value = new Date().toTimeString().slice(0, 5);
    }
    onBatchDateChange();
    lucide.createIcons();
}

function closeBatchModal() {
    document.getElementById('batchModal').classList.add('hidden');
}

function onBatchDateChange() {
    const batchDate = getBatchSelectedDate();
    // Desmarcar automáticamente cualquier persona que ya tenga registro en esa fecha
    Array.from(selectedBatchDnis).forEach(dniKey => {
        const emp = state.allEmployees.find(e => String(e.dni).trim() === dniKey);
        if (getEmployeeRecordForDate(dniKey, batchDate, emp ? emp.nombre : '')) {
            selectedBatchDnis.delete(dniKey);
        }
    });
    renderBatchStaffList();
    checkBatchTextareaDuplicates();
}

function updateBatchSelectedCount() {
    const badge = document.getElementById('batchSelectedCountBadge');
    if (badge) {
        badge.textContent = `${selectedBatchDnis.size} seleccionados`;
    }
}

function toggleBatchStaffItem(dni) {
    const key = String(dni).trim();
    const batchDate = getBatchSelectedDate();
    const emp = state.allEmployees.find(e => String(e.dni).trim() === key);
    const existingRec = getEmployeeRecordForDate(key, batchDate, emp ? emp.nombre : '');
    if (existingRec) {
        showDuplicateBlockedModal([{
            emp: emp || { dni: key, nombre: existingRec.nombre || key },
            fecha: batchDate,
            existingRec: existingRec
        }], 0);
        return;
    }
    if (selectedBatchDnis.has(key)) {
        selectedBatchDnis.delete(key);
    } else {
        selectedBatchDnis.add(key);
    }
    updateBatchSelectedCount();
    renderBatchStaffList();
}

function toggleAllBatchStaff(selectAll) {
    const filterInput = document.getElementById('batchStaffFilter');
    const query = filterInput ? filterInput.value.trim() : '';
    const filtered = filterEmployeesInMemory(query);
    const batchDate = getBatchSelectedDate();

    if (selectAll) {
        // Solo marcar los pendientes que NO estén registrados en esa fecha
        filtered.forEach(e => {
            const dniKey = String(e.dni).trim();
            if (!getEmployeeRecordForDate(dniKey, batchDate, e.nombre)) {
                selectedBatchDnis.add(dniKey);
            }
        });
    } else {
        selectedBatchDnis.clear();
    }
    updateBatchSelectedCount();
    renderBatchStaffList();
}

function renderBatchStaffList() {
    const container = document.getElementById('batchStaffCheckboxes');
    if (!container) return;

    const batchDate = getBatchSelectedDate();
    const hideRegisteredToggle = document.getElementById('hideAlreadyRegisteredBatchToggle');
    const hideRegistered = hideRegisteredToggle ? hideRegisteredToggle.checked : false;

    // Contar cuántos de toda la base ya están registrados en esta fecha
    const alreadyRegisteredCount = state.allEmployees.filter(e => Boolean(getEmployeeRecordForDate(e.dni, batchDate, e.nombre))).length;
    const alreadyBadge = document.getElementById('batchAlreadyRegisteredBadge');
    if (alreadyBadge) {
        alreadyBadge.textContent = `${alreadyRegisteredCount} ya registrados en ${batchDate}`;
    }

    const filterInput = document.getElementById('batchStaffFilter');
    const query = filterInput ? filterInput.value.trim() : '';
    let list = filterEmployeesInMemory(query);

    if (hideRegistered) {
        list = list.filter(emp => !getEmployeeRecordForDate(emp.dni, batchDate, emp.nombre));
    }

    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = `<p class="text-slate-500 text-xs col-span-2 py-2 text-center">No hay personal pendiente con ese filtro para la fecha ${batchDate}.</p>`;
        updateBatchSelectedCount();
        return;
    }

    list.forEach(emp => {
        const dniKey = String(emp.dni).trim();
        const existingRec = getEmployeeRecordForDate(dniKey, batchDate, emp.nombre);
        const isChecked = selectedBatchDnis.has(dniKey) && !existingRec;
        const div = document.createElement('div');

        if (existingRec) {
            const cleanIn = cleanTimeString(existingRec.hora_ingreso);
            div.onclick = () => showDuplicateBlockedModal([{ emp, fecha: batchDate, existingRec }], 0);
            div.className = "p-2 rounded-xl border cursor-not-allowed flex items-center justify-between bg-emerald-950/30 border-emerald-500/30 text-slate-400 opacity-75";
            div.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 pr-2">
                    <div class="w-4 h-4 rounded flex items-center justify-center border border-emerald-500/50 bg-emerald-900/50 text-emerald-300 text-[10px] font-bold shrink-0">
                        🔒
                    </div>
                    <div class="truncate">
                        <div class="text-xs font-semibold text-slate-300 truncate">${emp.nombre}</div>
                        <div class="text-[10px] text-emerald-400 font-mono">✅ Ya registrado (${cleanIn})</div>
                    </div>
                </div>
                <span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold shrink-0">Registrado</span>
            `;
        } else {
            div.onclick = () => toggleBatchStaffItem(dniKey);
            div.className = `p-2 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                isChecked 
                    ? 'bg-sky-950/80 border-sky-500/60 text-white' 
                    : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
            }`;

            const empresaTag = emp.empresa && emp.empresa !== 'INTERNO'
                ? `<span class="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-bold">${emp.empresa}</span>`
                : `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px]">Interno</span>`;

            div.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 pr-2">
                    <div class="w-4 h-4 rounded flex items-center justify-center border ${isChecked ? 'bg-sky-500 border-sky-400 text-white' : 'border-slate-600 bg-slate-800'} text-[10px] font-bold shrink-0">
                        ${isChecked ? '✓' : ''}
                    </div>
                    <div class="truncate">
                        <div class="text-xs font-semibold truncate">${emp.nombre}</div>
                        <div class="text-[10px] text-slate-400 font-mono">${emp.dni}</div>
                    </div>
                </div>
                ${empresaTag}
            `;
        }
        container.appendChild(div);
    });
    updateBatchSelectedCount();
}

// Verifica en vivo si algún DNI o Nombre escrito en el cuadro de texto de Carga Masiva ya está registrado en esa fecha
function checkBatchTextareaDuplicates() {
    const textarea = document.getElementById('batchListInput');
    const warningBox = document.getElementById('batchTextareaDuplicateWarning');
    if (!textarea || !warningBox) return;

    const rawList = textarea.value.trim();
    if (!rawList) {
        warningBox.classList.add('hidden');
        warningBox.innerHTML = '';
        return;
    }

    const defaultFecha = getBatchSelectedDate();
    const lines = rawList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const duplicatesFound = [];

    for (const line of lines) {
        const parts = line.split(/[,\t;|]+/).map(p => p.trim()).filter(Boolean);
        let lineFecha = defaultFecha;
        let term = line;

        if (parts.length >= 2) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                lineFecha = parts[0];
                term = parts[1];
            } else {
                term = parts[0];
            }
        }

        const emp = state.allEmployees.find(e => 
            (e.dni && e.dni.replace(/\s+/g, '') === term.replace(/\s+/g, '')) || 
            (e.nombre && normalizePersonText(e.nombre).includes(normalizePersonText(term)))
        );

        const dniToCheck = emp ? emp.dni : term;
        const nameToCheck = emp ? emp.nombre : term;
        const existingRec = getEmployeeRecordForDate(dniToCheck, lineFecha, nameToCheck);

        if (existingRec) {
            duplicatesFound.push({
                emp: emp || { dni: existingRec.dni || term, nombre: existingRec.nombre || term },
                fecha: lineFecha,
                existingRec: existingRec
            });
        }
    }

    if (duplicatesFound.length > 0) {
        warningBox.classList.remove('hidden');
        warningBox.innerHTML = `
            <div class="font-bold text-rose-300 flex items-center gap-1.5">
                <span>🚫 No se puede registrar (Personal ya se encuentra registrado en la fecha):</span>
            </div>
            <div class="space-y-1">
                ${duplicatesFound.map(d => {
                    const cleanIn = cleanTimeString(d.existingRec.hora_ingreso) || '--';
                    const cleanOut = cleanTimeString(d.existingRec.hora_salida);
                    return `<div class="text-[11px] font-mono bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-rose-500/40 text-rose-200">
                        <strong>${d.emp.nombre}</strong> (DNI: ${d.emp.dni}) &bull; Fecha: <strong>${d.fecha}</strong> &bull; Ingreso: ${cleanIn}${cleanOut ? ' | Salida: ' + cleanOut : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    } else {
        warningBox.classList.add('hidden');
        warningBox.innerHTML = '';
    }
}

async function submitBatchCheckIn(keepOpen = false) {
    const dateInput = document.getElementById('batchDateInput');
    const rawTime = document.getElementById('batchTimeInput').value;
    const rawExitTime = document.getElementById('batchExitTimeInput') ? document.getElementById('batchExitTimeInput').value : '';
    const rawList = document.getElementById('batchListInput').value.trim();
    const notesInput = document.getElementById('batchNotesInput');
    const customNotes = (notesInput && notesInput.value.trim()) ? notesInput.value.trim() : 'Carga Masiva / Regularización por Día';

    const defaultFecha = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
    const defaultHoraIngreso = rawTime ? (rawTime.length === 5 ? rawTime + ':00' : rawTime) : new Date().toLocaleTimeString('es-ES');
    const defaultHoraSalida = rawExitTime ? (rawExitTime.length === 5 ? rawExitTime + ':00' : rawExitTime) : '';
    const userEmail = getUserEmail();

    if (!state.allRecords || state.allRecords.length === 0) {
        await loadTodayData();
    }

    const entriesToProcess = [];

    // 1. Personal seleccionado mediante Checkboxes
    selectedBatchDnis.forEach(dniKey => {
        const emp = state.allEmployees.find(e => String(e.dni).trim() === dniKey);
        if (emp) {
            entriesToProcess.push({
                emp: emp,
                fecha: defaultFecha,
                horaIngreso: defaultHoraIngreso,
                horaSalida: defaultHoraSalida
            });
        }
    });

    // 2. Líneas pegadas en el cuadro de texto
    if (rawList) {
        const lines = rawList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
            const parts = line.split(/[,\t;|]+/).map(p => p.trim()).filter(Boolean);
            let lineFecha = defaultFecha;
            let term = line;
            let lineIngreso = defaultHoraIngreso;
            let lineSalida = defaultHoraSalida;

            if (parts.length >= 2) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                    lineFecha = parts[0];
                    term = parts[1];
                    if (parts[2]) lineIngreso = parts[2].length === 5 ? parts[2] + ':00' : parts[2];
                    if (parts[3]) lineSalida = parts[3].length === 5 ? parts[3] + ':00' : parts[3];
                } else {
                    term = parts[0];
                    if (parts[1]) lineIngreso = parts[1].length === 5 ? parts[1] + ':00' : parts[1];
                    if (parts[2]) lineSalida = parts[2].length === 5 ? parts[2] + ':00' : parts[2];
                }
            }

            let emp = state.allEmployees.find(e => 
                (e.dni && e.dni.replace(/\s+/g, '') === term.replace(/\s+/g, '')) || 
                (e.nombre && normalizePersonText(e.nombre).includes(normalizePersonText(term)))
            );

            if (!emp) {
                emp = {
                    dni: /^\d+$/.test(term) ? term : 'DNI-' + Math.floor(100000 + Math.random() * 900000),
                    nombre: term,
                    empresa: 'INTERNO'
                };
            }

            entriesToProcess.push({
                emp: emp,
                fecha: lineFecha,
                horaIngreso: lineIngreso,
                horaSalida: lineSalida
            });
        }
    }

    if (entriesToProcess.length === 0) {
        showToast('Selecciona al menos un personal de la lista o escribe un DNI/Nombre', 'error');
        return;
    }

    let registeredCount = 0;
    const blockedDuplicates = [];

    for (const item of entriesToProcess) {
        const { emp, fecha, horaIngreso, horaSalida } = item;

        // Filtro Anti-Duplicidad en la misma fecha (por DNI o por Nombre)
        const existingRec = getEmployeeRecordForDate(emp.dni, fecha, emp.nombre);
        if (existingRec) {
            blockedDuplicates.push({
                emp: emp,
                fecha: fecha,
                existingRec: existingRec
            });
            continue;
        }

        const isCompleto = Boolean(horaSalida);
        const horasTrabajadas = isCompleto ? calculateDurationHHMMSS(horaIngreso, horaSalida) : '';
        const estadoFinal = isCompleto ? 'COMPLETADO' : 'EN_TURNO';

        try {
            await fetch(state.sheetsUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'record_attendance',
                    dni: emp.dni,
                    nombre: emp.nombre,
                    empresa: emp.empresa,
                    fecha: fecha,
                    hora_ingreso: horaIngreso,
                    hora_salida: horaSalida || '',
                    horas_trabajadas: horasTrabajadas,
                    estado: estadoFinal,
                    notas: customNotes,
                    registrado_por: userEmail
                })
            });
            state.allRecords.push({
                dni: emp.dni,
                nombre: emp.nombre,
                empresa: emp.empresa,
                fecha: normalizeDateString(fecha),
                hora_ingreso: horaIngreso,
                hora_salida: horaSalida || '',
                horas_trabajadas: horasTrabajadas,
                estado: estadoFinal,
                notas: customNotes,
                registrado_por: userEmail
            });
            registeredCount++;
        } catch (e) {}
    }

    // Si todos los intentados ya estaban registrados, NO cerrar la ventana y mostrar el Cuadro de Mensaje de Bloqueo
    if (registeredCount === 0 && blockedDuplicates.length > 0) {
        showDuplicateBlockedModal(blockedDuplicates, 0);
        return;
    }

    playSuccessSound();
    showToast(`✅ Día ${defaultFecha}: ${registeredCount} registro(s) guardado(s) correctamente`, 'success');

    if (blockedDuplicates.length > 0) {
        showDuplicateBlockedModal(blockedDuplicates, registeredCount);
    }
    
    selectedBatchDnis.clear();
    updateBatchSelectedCount();
    document.getElementById('batchListInput').value = '';
    checkBatchTextareaDuplicates();

    if (!keepOpen && blockedDuplicates.length === 0) {
        closeBatchModal();
    }
    await refreshAllData();
    renderBatchStaffList();
}

function triggerQuickAdd(query) {
    searchResults.classList.add('hidden');
    searchResults.style.display = 'none';
    openNewPersonModal();
    if (/^\d+$/.test(query)) {
        document.getElementById('newDni').value = query;
    } else {
        document.getElementById('newNombre').value = query;
    }
    checkNewPersonDuplicate();
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

        const cleanTime = cleanTimeString(item.hora_ingreso);

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold text-xs flex items-center justify-center">
                    ${getInitials(item.nombre)}
                </div>
                <div>
                    <div class="text-xs font-bold text-white">${item.nombre}</div>
                    <div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400">
                        <span>Ingreso: <strong class="text-emerald-400 font-mono">${cleanTime || '--'}</strong></span>
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

// Filtra y renderiza la tabla inferior por Fecha y Texto
function clearTableDateFilter() {
    const filterDateInput = document.getElementById('filterTableDateInput');
    if (filterDateInput) filterDateInput.value = '';
    applyTableFilters();
}

function applyTableFilters() {
    const filterDateInput = document.getElementById('filterTableDateInput');
    const filterTextInput = document.getElementById('filterTableInput');
    const targetDate = filterDateInput ? filterDateInput.value.trim() : '';
    const query = filterTextInput ? filterTextInput.value.trim().toLowerCase() : '';

    const source = (state.allRecords && state.allRecords.length > 0)
        ? state.allRecords
        : (state.todayData.registros_hoy || []);

    const filtered = source.filter(r => {
        const recDate = normalizeDateString(r.fecha);
        if (targetDate && recDate !== targetDate) return false;
        if (query) {
            const text = `${r.nombre || ''} ${r.dni || ''} ${r.empresa || ''} ${r.notas || ''} ${r.registrado_por || ''}`.toLowerCase();
            if (!text.includes(query)) return false;
        }
        return true;
    });

    renderTable(filtered.slice().reverse());
}

function renderTable(list) {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="px-4 py-8 text-center text-slate-500">
                    No se registran marcaciones para la fecha/filtro seleccionado.
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

        const fechaClean = normalizeDateString(row.fecha);
        const horaIngresoClean = cleanTimeString(row.hora_ingreso);
        const horaSalidaClean = cleanTimeString(row.hora_salida);

        tr.innerHTML = `
            <td class="px-4 py-3 font-mono text-amber-300 font-semibold">${fechaClean || '--'}</td>
            <td class="px-4 py-3 font-semibold text-white">${row.nombre}</td>
            <td class="px-4 py-3 font-mono text-slate-400">${row.dni}</td>
            <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold border border-slate-700">${row.empresa || 'INTERNO'}</span>
            </td>
            <td class="px-4 py-3 font-mono text-emerald-400 font-bold">${horaIngresoClean || '--'}</td>
            <td class="px-4 py-3 font-mono text-amber-400 font-bold">${horaSalidaClean || '--'}</td>
            <td class="px-4 py-3 font-mono text-slate-300">${row.horas_trabajadas || '--'}</td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3 text-slate-400 truncate max-w-xs">${row.notas || '--'}</td>
            <td class="px-4 py-3 font-mono text-[11px] text-sky-400 font-semibold">${row.registrado_por || 'akmseguridad@gmail.com'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterHistoryTable() {
    applyTableFilters();
}

// Modal Handlers (Nuevo Personal con Filtro Anti-Duplicidad en Vivo)
function openNewPersonModal() {
    document.getElementById('newPersonModal').classList.remove('hidden');
    const dniInput = document.getElementById('newDni');
    const nombreInput = document.getElementById('newNombre');
    const empresaInput = document.getElementById('newEmpresa');
    if (dniInput) dniInput.value = '';
    if (nombreInput) nombreInput.value = '';
    if (empresaInput) empresaInput.value = 'INTERNO';
    checkNewPersonDuplicate();
    lucide.createIcons();
}

function closeNewPersonModal() {
    document.getElementById('newPersonModal').classList.add('hidden');
}

function findDuplicateOrSimilarNewPerson(rawDni, rawNombre) {
    const cleanDni = String(rawDni || '').replace(/\s+/g, '').trim().toLowerCase();
    const normNombre = normalizePersonText(rawNombre);
    const sortedTokens = getSortedNameTokensKey(rawNombre);
    const inputWords = normNombre.split(' ').filter(w => w.length >= 3);

    let exactMatch = null;
    const similarMatches = [];

    for (const emp of state.allEmployees) {
        const empDni = String(emp.dni || '').replace(/\s+/g, '').trim().toLowerCase();
        const empNormName = normalizePersonText(emp.nombre);
        const empSortedTokens = getSortedNameTokensKey(emp.nombre);

        // 1. Coincidencia exacta por DNI o por Nombre Completo (incluso si invirtieron apellidos y nombres)
        const isExactDni = cleanDni.length >= 4 && empDni === cleanDni;
        const isExactName = normNombre.length >= 4 && (empNormName === normNombre || empSortedTokens === sortedTokens);

        if (isExactDni || isExactName) {
            exactMatch = { emp, reason: isExactDni && isExactName ? 'DNI y Nombre idénticos' : (isExactDni ? 'Mismo DNI' : 'Mismo Nombre') };
            break;
        }

        // 2. Coincidencia parcial / similar para alertar antes de duplicar
        const isSimilarDni = cleanDni.length >= 3 && empDni.includes(cleanDni);
        const isSubstringName = normNombre.length >= 3 && (empNormName.includes(normNombre) || normNombre.includes(empNormName));
        const sharedWordsCount = inputWords.filter(w => empNormName.includes(w)).length;
        const isMultiWordSimilar = inputWords.length >= 2 && sharedWordsCount >= 2;

        if (isSimilarDni || isSubstringName || isMultiWordSimilar) {
            similarMatches.push(emp);
        }
    }

    return { exactMatch, similarMatches: similarMatches.slice(0, 4) };
}

function useExistingPersonFromModal(dni) {
    const target = state.allEmployees.find(e => String(e.dni).trim() === String(dni).trim());
    if (target) {
        closeNewPersonModal();
        selectEmployee(target);
        showToast(`✅ Personal existente seleccionado: ${target.nombre}`, 'info');
    }
}

function checkNewPersonDuplicate() {
    const dniInput = document.getElementById('newDni');
    const nombreInput = document.getElementById('newNombre');
    const container = document.getElementById('newPersonDuplicateContainer');
    const btnSave = document.getElementById('btnSaveNewPerson');

    if (!container || !btnSave) return;

    const rawDni = dniInput ? dniInput.value.trim() : '';
    const rawNombre = nombreInput ? nombreInput.value.trim() : '';

    if (!rawDni && !rawNombre) {
        container.classList.add('hidden');
        container.innerHTML = '';
        btnSave.disabled = false;
        btnSave.className = "px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/30 transition-all";
        btnSave.textContent = 'Guardar y Seleccionar';
        return;
    }

    const { exactMatch, similarMatches } = findDuplicateOrSimilarNewPerson(rawDni, rawNombre);

    if (exactMatch) {
        const emp = exactMatch.emp;
        container.classList.remove('hidden');
        container.className = "rounded-2xl border p-3.5 text-xs space-y-2.5 bg-rose-950/80 border-rose-500/60 text-rose-200";
        container.innerHTML = `
            <div class="flex items-start gap-2">
                <span class="text-base leading-none">🚫</span>
                <div class="space-y-1 flex-1">
                    <p class="font-bold text-rose-300">DUPLICIDAD BLOQUEADA (${exactMatch.reason})</p>
                    <p class="text-[11px] text-rose-200/90">Esta persona <strong>ya está registrada</strong> en la Base de Datos de Personal:</p>
                </div>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-rose-500/40 flex items-center justify-between gap-2">
                <div>
                    <div class="font-bold text-white text-xs">${emp.nombre}</div>
                    <div class="text-[11px] text-slate-400 font-mono">DNI: ${emp.dni} &bull; <span class="text-indigo-300 font-semibold">${emp.empresa || 'INTERNO'}</span></div>
                </div>
                <button type="button" onclick="useExistingPersonFromModal('${emp.dni}')"
                        class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shrink-0 shadow">
                    ✅ Usar Existente
                </button>
            </div>
        `;
        btnSave.disabled = true;
        btnSave.className = "px-5 py-2.5 rounded-xl bg-slate-800 text-slate-500 border border-slate-700 text-xs font-bold cursor-not-allowed opacity-60";
        btnSave.textContent = '🔒 Ya Existe en Base de Datos';
        return;
    }

    // Habilitar botón si no hay duplicado exacto
    btnSave.disabled = false;
    btnSave.className = "px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/30 transition-all";
    btnSave.textContent = 'Guardar y Seleccionar';

    if (similarMatches.length > 0) {
        container.classList.remove('hidden');
        container.className = "rounded-2xl border p-3 text-xs space-y-2 bg-amber-950/60 border-amber-500/40 text-amber-200";
        const itemsHtml = similarMatches.map(emp => `
            <div class="p-2 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
                <div class="truncate">
                    <div class="font-bold text-white text-xs truncate">${emp.nombre}</div>
                    <div class="text-[10px] text-slate-400 font-mono">DNI: ${emp.dni} &bull; ${emp.empresa || 'INTERNO'}</div>
                </div>
                <button type="button" onclick="useExistingPersonFromModal('${emp.dni}')"
                        class="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-[10px] shrink-0">
                    Seleccionar
                </button>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="font-bold text-amber-300 text-[11px] flex items-center gap-1.5">
                <span>🔍 Personal similar ya registrado (verifica antes de crear):</span>
            </div>
            <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                ${itemsHtml}
            </div>
        `;
    } else {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
}

let isSavingNewPerson = false;

async function saveNewPerson() {
    if (isSavingNewPerson) return;

    const dni = document.getElementById('newDni').value.trim();
    const nombre = document.getElementById('newNombre').value.trim();
    const empresa = document.getElementById('newEmpresa').value.trim() || 'INTERNO';
    const btnSave = document.getElementById('btnSaveNewPerson');

    if (!dni || !nombre) {
        showToast('Completa el DNI y el Nombre Completo', 'error');
        return;
    }

    // Validación estricta Anti-Duplicidad (por DNI o por Nombre)
    const { exactMatch } = findDuplicateOrSimilarNewPerson(dni, nombre);
    if (exactMatch) {
        showToast(`🚫 Duplicado bloqueado: "${exactMatch.emp.nombre}" (DNI: ${exactMatch.emp.dni}) ya existe. Se seleccionó su ficha existente.`, 'error');
        useExistingPersonFromModal(exactMatch.emp.dni);
        return;
    }

    isSavingNewPerson = true;
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.textContent = 'Guardando...';
    }

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

    if (!state.sheetsUrl) {
        showToast('Configura la URL de Google Sheets primero', 'error');
        isSavingNewPerson = false;
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = 'Guardar y Seleccionar';
        }
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

        showToast(`Personal registrado sin duplicidad: ${nombre}`, 'success');
        closeNewPersonModal();
        const newEmp = { dni, nombre, empresa, estado_hoy: 'FUERA' };
        state.allEmployees = deduplicateEmployeeList([...state.allEmployees, newEmp]);
        selectEmployee(newEmp);
        await refreshAllData();
    } catch (err) {
        showToast('Error al enviar personal a Google Sheets', 'error');
    } finally {
        isSavingNewPerson = false;
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = 'Guardar y Seleccionar';
        }
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

    let csvContent = "data:text/csv;charset=utf-8,DNI,Nombre,Empresa,Fecha,Hora Ingreso,Hora Salida,Horas Trabajadas,Estado,Notas,Registrado Por\n";
    records.forEach(r => {
        csvContent += `"${r.dni}","${r.nombre}","${r.empresa || 'INTERNO'}","${r.fecha}","${r.hora_ingreso || ''}","${r.hora_salida || ''}","${r.horas_trabajadas || ''}","${r.estado}","${r.notas || ''}","${r.registrado_por || 'akmseguridad@gmail.com'}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `asistencia_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
