/**
 * CONTROL DE ASISTENCIA - SCRIPT PARA GOOGLE SHEETS
 * 
 * INSTRUCCIONES:
 * 1. En tu Google Sheet, ve al menú: Extensiones -> Apps Script
 * 2. Borra todo el código existente y pega este archivo completo.
 * 3. Haz clic en "Implementar" (Deploy) -> "Nueva implementación" (New deployment).
 * 4. Selecciona tipo "Aplicación Web" (Web app).
 * 5. Configura:
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier persona (Anyone)
 * 6. Haz clic en "Implementar" y copia la URL generada.
 * 7. Pega esa URL en el panel de Configuración de la Aplicación Web.
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets(ss);
  
  var action = e.parameter.action || 'get_all';
  var response = {};
  
  if (action === 'get_personal') {
    response = { status: 'success', data: getPersonalData(ss) };
  } else if (action === 'get_attendance') {
    response = { status: 'success', data: getAttendanceData(ss) };
  } else {
    response = {
      status: 'success',
      personal: getPersonalData(ss),
      attendance: getAttendanceData(ss)
    };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets(ss);
  
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    data = e.parameter;
  }
  
  var action = data.action;
  
  if (action === 'add_personal') {
    addOrUpdatePersonal(ss, data.dni, data.nombre, data.empresa);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Personal registrado' }))
      .setMimeType(ContentService.MimeType.JSON);
  } 
  else if (action === 'record_attendance') {
    recordAttendance(ss, data);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Asistencia registrada' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Acción desconocida' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheets(ss) {
  // Pestaña 1: Personal
  var personalSheet = ss.getSheetByName('Personal');
  if (!personalSheet) {
    personalSheet = ss.insertSheet('Personal');
    personalSheet.appendRow(['DNI', 'Nombre Completo', 'Empresa / Contrata', 'Fecha Registro']);
    personalSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E0E7FF');
  }
  
  // Pestaña 2: Registro_Asistencia
  var attendanceSheet = ss.getSheetByName('Registro_Asistencia');
  if (!attendanceSheet) {
    attendanceSheet = ss.insertSheet('Registro_Asistencia');
    attendanceSheet.appendRow(['DNI', 'Nombre Completo', 'Empresa', 'Fecha', 'Hora Ingreso', 'Hora Salida', 'Horas Trabajadas', 'Estado', 'Notas']);
    attendanceSheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#DCFCE7');
  }
}

function getPersonalData(ss) {
  var sheet = ss.getSheetByName('Personal');
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  
  var list = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0]) {
      list.push({
        dni: String(values[i][0]),
        nombre: String(values[i][1]),
        empresa: String(values[i][2] || 'INTERNO')
      });
    }
  }
  return list;
}

function getAttendanceData(ss) {
  var sheet = ss.getSheetByName('Registro_Asistencia');
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  
  var list = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0]) {
      list.push({
        dni: String(values[i][0]),
        nombre: String(values[i][1]),
        empresa: String(values[i][2]),
        fecha: String(values[i][3]),
        hora_ingreso: String(values[i][4]),
        hora_salida: String(values[i][5]),
        horas_trabajadas: String(values[i][6]),
        estado: String(values[i][7]),
        notas: String(values[i][8])
      });
    }
  }
  return list;
}

function addOrUpdatePersonal(ss, dni, nombre, empresa) {
  var sheet = ss.getSheetByName('Personal');
  var values = sheet.getDataRange().getValues();
  var foundRow = -1;
  
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(dni)) {
      foundRow = i + 1;
      break;
    }
  }
  
  if (foundRow > 0) {
    sheet.getRange(foundRow, 2).setValue(nombre);
    sheet.getRange(foundRow, 3).setValue(empresa || 'INTERNO');
  } else {
    sheet.appendRow([String(dni), nombre, empresa || 'INTERNO', new Date().toISOString().split('T')[0]]);
  }
}

function recordAttendance(ss, data) {
  var sheet = ss.getSheetByName('Registro_Asistencia');
  var values = sheet.getDataRange().getValues();
  var foundRow = -1;
  
  // Buscar si ya existe la fila para este DNI y Fecha activa en EN_TURNO
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(data.dni) && 
        String(values[i][3]) === String(data.fecha) && 
        String(values[i][7]) === 'EN_TURNO') {
      foundRow = i + 1;
      break;
    }
  }
  
  if (foundRow > 0 && data.hora_salida) {
    // Actualizar Salida
    sheet.getRange(foundRow, 6).setValue(data.hora_salida);
    sheet.getRange(foundRow, 7).setValue(data.horas_trabajadas || '');
    sheet.getRange(foundRow, 8).setValue(data.estado || 'COMPLETADO');
    if (data.notas) {
      sheet.getRange(foundRow, 9).setValue(data.notas);
    }
  } else {
    // Insertar nuevo registro de Ingreso
    sheet.appendRow([
      String(data.dni),
      data.nombre,
      data.empresa || 'INTERNO',
      data.fecha,
      data.hora_ingreso,
      data.hora_salida || '',
      data.horas_trabajadas || '',
      data.estado || 'EN_TURNO',
      data.notas || ''
    ]);
  }
}
