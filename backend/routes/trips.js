import express from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import * as XLSX from 'xlsx';
import { insertTripRecord } from '../utils/tripPersistence.js';
import { mapExcelSheetsToTripFields } from '../utils/geminiTripMapper.js';

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXCEL_EXTENSIONS = new Set(['xls', 'xlsx']);

function getExtension(fileName = '') {
    return path.extname(fileName).replace('.', '').toLowerCase();
}

function isAllowedExcelFile(fileName = '') {
    return ALLOWED_EXCEL_EXTENSIONS.has(getExtension(fileName));
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: MAX_FILE_SIZE_BYTES,
    },
    fileFilter: (_request, file, callback) => {
        if (!isAllowedExcelFile(file.originalname)) {
            return callback(new Error('Only Excel files (.xls and .xlsx) are allowed.'));
        }

        return callback(null, true);
    },
});

function runSingleUpload(request, response) {
    return new Promise((resolve, reject) => {
        upload.single('file')(request, response, (error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function sheetToCompactJson(worksheet) {
    const matrix = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
        raw: false,
        blankrows: false,
    });

    if (!matrix.length) {
        return {
            columns: [],
            rows: [],
        };
    }

    const [headerRow, ...dataRows] = matrix;
    const maxColumns = Math.max(headerRow.length, ...dataRows.map((row) => row.length));

    const columns = Array.from({ length: maxColumns }, (_value, index) => {
        const headerValue = headerRow[index];

        if (headerValue === null || headerValue === undefined) {
            return `column_${index + 1}`;
        }

        const normalizedHeader = String(headerValue).trim();
        return normalizedHeader || `column_${index + 1}`;
    });

    const rows = dataRows
        .map((row) => columns.map((_column, index) => (row[index] === undefined ? null : row[index])))
        .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''));

    return {
        columns,
        rows,
    };
}

// POST /api/trips/excel-upload
router.post('/excel-upload', async (request, response) => {
    try {
        await runSingleUpload(request, response);
        const fleetManagerId = request.body?.fleet_manager_id;

        if (!request.file) {
            return response.status(400).json({
                error: 'Excel file is required in the "file" field.',
            });
        }

        if (!fleetManagerId) {
            return response.status(400).json({
                error: 'fleet_manager_id is required in form data.',
            });
        }

        const workbook = XLSX.read(request.file.buffer, {
            type: 'buffer',
            cellDates: true,
        });

        if (!workbook.SheetNames.length) {
            return response.status(400).json({ error: 'Uploaded Excel file has no sheets.' });
        }

        const sheets = workbook.SheetNames.map((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            return {
                sheetName,
                ...sheetToCompactJson(worksheet),
            };
        });

        const nonEmptySheets = sheets.filter((sheet) => sheet.rows.length > 0);

        if (!nonEmptySheets.length) {
            return response.status(200).json({ saved: 0 });
        }

        const mappedRows = await mapExcelSheetsToTripFields(nonEmptySheets);

        if (!mappedRows.length) {
            return response.status(200).json({ saved: 0 });
        }

        const rowsToSave = mappedRows.filter((row) =>
            row && Object.values(row).some((value) => value !== null && value !== undefined && String(value).trim() !== '')
        );

        if (!rowsToSave.length) {
            return response.status(200).json({ saved: 0 });
        }

        let saved = 0;
        let failed = 0;
        let firstError = '';

        for (let index = 0; index < rowsToSave.length; index += 1) {
            try {
                const row = rowsToSave[index];
                const finalFleetManagerId = row.fleet_manager_id || fleetManagerId;

                await insertTripRecord(pool, {
                    ...row,
                    fleet_manager_id: finalFleetManagerId,
                });
                saved += 1;
            } catch (error) {
                failed += 1;

                if (!firstError) {
                    firstError = `Row ${index + 1}: ${error.message}`;
                }
            }
        }

        if (saved === 0 && failed > 0) {
            return response.status(400).json({ error: firstError, failed });
        }

        if (failed > 0) {
            return response.status(200).json({ saved, failed, first_error: firstError });
        }

        return response.status(201).json({ saved });
    } catch (error) {
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return response.status(400).json({ error: 'File size must be 50 MB or less.' });
            }

            if (error.code === 'LIMIT_FILE_COUNT') {
                return response.status(400).json({ error: 'Only one file can be uploaded at a time.' });
            }

            return response.status(400).json({ error: error.message || 'Invalid file upload request.' });
        }

        if (error?.statusCode) {
            return response.status(error.statusCode).json({ error: error.message });
        }

        if (error.message) {
            return response.status(400).json({ error: error.message });
        }

        console.error('Excel upload parse error:', error);
        return response.status(500).json({ error: 'Unable to parse the uploaded Excel file.' });
    }
});

// POST /api/trips/create-trip
router.post('/create-trip', async (req, res) => {
    try {
        const result = await insertTripRecord(pool, req.body);
        return res.status(201).json(result);
    } catch (e) {
        if (e?.statusCode) {
            return res.status(e.statusCode).json({ error: e.message });
        }
        console.error('Error creating trip:', e);
        return res.status(500).json({ error: e.message || 'Internal server error.' });
    }
});

export default router;
