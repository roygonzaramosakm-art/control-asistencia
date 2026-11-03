/**
 * CONTROL DE ASISTENCIA - SCRIPT COMPLETO Y OPTIMIZADO PARA GOOGLE SHEETS
 * Incluye registro de usuario/cuenta que realiza la marca (Registrado Por).
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets(ss);
  
  var attendanceSheet = ss.getSheetByName('Registro_Asistencia');
  if (attendanceSheet) autoCalculateMissingHours(attendanceSheet);
  
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
    
    var attendanceSheet = ss.getSheetByName('Registro_Asistencia');
    if (attendanceSheet) autoCalculateMissingHours(attendanceSheet);
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Asistencia registrada' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Acción desconocida' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheets(ss) {
  var personalSheet = ss.getSheetByName('Personal');
  if (!personalSheet) {
    personalSheet = ss.insertSheet('Personal');
    personalSheet.appendRow(['DNI', 'Nombre Completo', 'Empresa / Contrata', 'Fecha Registro']);
    personalSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E0E7FF');
  }
  
  var attendanceSheet = ss.getSheetByName('Registro_Asistencia');
  if (!attendanceSheet) {
    attendanceSheet = ss.insertSheet('Registro_Asistencia');
    attendanceSheet.appendRow(['DNI', 'Nombre Completo', 'Empresa', 'Fecha', 'Hora Ingreso', 'Hora Salida', 'Horas Trabajadas', 'Estado', 'Notas', 'Registrado Por']);
    attendanceSheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#DCFCE7');
  } else {
    // Verificar si existe la columna 10 'Registrado Por'
    var headers = attendanceSheet.getRange(1, 1, 1, 10).getValues()[0];
    if (!headers[9]) {
      attendanceSheet.getRange(1, 10).setValue('Registrado Por').setFontWeight('bold').setBackground('#DCFCE7');
    }
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
        dni: String(values[i][0]).trim(),
        nombre: String(values[i][1]).trim(),
        empresa: String(values[i][2] || 'INTERNO').trim()
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
        dni: String(values[i][0]).trim(),
        nombre: String(values[i][1]).trim(),
        empresa: String(values[i][2]).trim(),
        fecha: String(values[i][3]).trim(),
        hora_ingreso: cleanTimeStr(values[i][4]),
        hora_salida: cleanTimeStr(values[i][5]),
        horas_trabajadas: String(values[i][6]).trim(),
        estado: String(values[i][7]).trim(),
        notas: String(values[i][8]).trim(),
        registrado_por: String(values[i][9] || 'akmseguridad@gmail.com').trim()
      });
    }
  }
  return list;
}

function addOrUpdatePersonal(ss, dni, nombre, empresa) {
  var sheet = ss.getSheetByName('Personal');
  var values = sheet.getDataRange().getValues();
  var foundRow = -1;
  var targetDni = String(dni).replace(/\s+/g, '');
  
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).replace(/\s+/g, '') === targetDni) {
      foundRow = i + 1;
      break;
    }
  }
  
  if (foundRow > 0) {
    sheet.getRange(foundRow, 2).setValue(nombre);
    sheet.getRange(foundRow, 3).setValue(empresa || 'INTERNO');
  } else {
    sheet.appendRow([String(dni).trim(), nombre, empresa || 'INTERNO', new Date().toISOString().split('T')[0]]);
  }
}

function recordAttendance(ss, data) {
  var sheet = ss.getSheetByName('Registro_Asistencia');
  var values = sheet.getDataRange().getValues();
  var foundRow = -1;
  var targetDni = String(data.dni).replace(/\s+/g, '');
  var userEmail = data.registrado_por || data.usuario || 'akmseguridad@gmail.com';
  
  // Solo buscar fila activa en EN_TURNO cuando se está marcando una SALIDA (sin hora_ingreso simultánea)
  if (!data.hora_ingreso) {
    for (var i = values.length - 1; i >= 1; i--) {
      var cellDni = String(values[i][0]).replace(/\s+/g, '');
      var cellStatus = String(values[i][7]).trim();
      if (cellDni === targetDni && cellStatus === 'EN_TURNO') {
        foundRow = i + 1;
        break;
      }
    }
  }
  
  if (foundRow > 0 && !data.hora_ingreso && (data.hora_salida || data.estado === 'COMPLETADO')) {
    // Fila encontrada: Actualizar SALIDA en la misma fila del INGRESO
    var valIngreso = values[foundRow - 1][4]; // Columna E: Hora Ingreso
    var horaSalidaStr = data.hora_salida || new Date().toLocaleTimeString('es-ES');
    
    // Calcular Horas Trabajadas en formato regular estándar HH:MM:SS
    var secIngreso = parseTimeSeconds(valIngreso);
    var secSalida = parseTimeSeconds(horaSalidaStr);
    
    var diffSecs = secSalida - secIngreso;
    if (diffSecs < 0) {
      diffSecs += 24 * 3600; // Turno nocturno que cruza la medianoche
    }
    
    var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
    var h = Math.floor(diffSecs / 3600);
    var m = Math.floor((diffSecs % 3600) / 60);
    var s = Math.floor(diffSecs % 60);
    
    var horasCalculadas = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    
    sheet.getRange(foundRow, 6).setValue(horaSalidaStr);   // Columna F: Hora Salida
    sheet.getRange(foundRow, 7).setValue(horasCalculadas); // Columna G: Horas Trabajadas
    sheet.getRange(foundRow, 8).setValue('COMPLETADO');    // Columna H: Estado
    
    if (data.notas) {
      var prevNotas = String(values[foundRow - 1][8] || '');
      var notasFinales = prevNotas ? prevNotas + ' | Salida: ' + data.notas : data.notas;
      sheet.getRange(foundRow, 9).setValue(notasFinales);  // Columna I: Notas
    }
    
    var prevUser = String(values[foundRow - 1][9] || '').trim();
    var userFinal = userEmail;
    if (prevUser && prevUser !== userEmail) {
      userFinal = prevUser + ' | Salida: ' + userEmail;
    }
    sheet.getRange(foundRow, 10).setValue(userFinal);     // Columna J: Registrado Por
  } else {
    // No hay fila activa: Insertar nueva fila de INGRESO
    sheet.appendRow([
      String(data.dni).trim(),
      data.nombre,
      data.empresa || 'INTERNO',
      data.fecha || new Date().toISOString().split('T')[0],
      data.hora_ingreso || new Date().toLocaleTimeString('es-ES'),
      data.hora_salida || '',
      data.horas_trabajadas || '',
      data.estado || 'EN_TURNO',
      data.notas || '',
      userEmail                                           // Columna J: Registrado Por
    ]);
  }
}

// Escáner y recalculador automático de cualquier fila con Ingreso + Salida sin horas calculadas
function autoCalculateMissingHours(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  
  for (var i = 1; i < values.length; i++) {
    var valIngreso = values[i][4]; // Columna E: Hora Ingreso
    var valSalida = values[i][5];  // Columna F: Hora Salida
    var valHoras = values[i][6];   // Columna G: Horas Trabajadas
    
    if (valIngreso && valSalida && (!valHoras || String(valHoras).trim() === '' || String(valHoras).includes('NaN'))) {
      var secIngreso = parseTimeSeconds(valIngreso);
      var secSalida = parseTimeSeconds(valSalida);
      
      var diffSecs = secSalida - secIngreso;
      if (diffSecs < 0) {
        diffSecs += 24 * 3600; // Turno nocturno que cruza la medianoche
      }
      
      var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
      var h = Math.floor(diffSecs / 3600);
      var m = Math.floor((diffSecs % 3600) / 60);
      var s = Math.floor(diffSecs % 60);
      var horasCalculadas = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
      
      sheet.getRange(i + 1, 7).setValue(horasCalculadas); // Columna G: Horas Trabajadas
      if (!values[i][7] || String(values[i][7]).trim() === '' || String(values[i][7]) === 'EN_TURNO') {
        sheet.getRange(i + 1, 8).setValue('COMPLETADO'); // Columna H: Estado
      }
    }
  }
}

function parseTimeSeconds(val) {
  if (!val) return 0;
  
  if (val instanceof Date) {
    return val.getHours() * 3600 + val.getMinutes() * 60 + val.getSeconds();
  }
  
  var str = String(val).trim();
  var match = str.match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (match) {
    var h = parseInt(match[1], 10);
    var m = parseInt(match[2], 10);
    var s = parseInt(match[3] || 0, 10);
    return h * 3600 + m * 60 + s;
  }
  
  return 0;
}

function cleanTimeStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toLocaleTimeString('es-ES');
  }
  var str = String(val).trim();
  var match = str.match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (match) return match[0];
  return str;
}
