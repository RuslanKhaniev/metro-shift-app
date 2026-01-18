/**
 * calculator.js
 * Версия 5.1: Исправлено отображение "На руки" в карточках смен.
 */

const Calculator = {
    
    toMins(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    },

    getDuration(start, end) {
        if (end < start) end += 24 * 60;
        return Math.max(0, end - start);
    },

    getIntersection(start1, end1, start2, end2) {
        if (end1 < start1) end1 += 1440;
        if (end2 < start2) {
            return this.getIntersection(start1, end1, start2, 1440) + 
                   this.getIntersection(start1, end1, 0, end2);
        }
        const s = Math.max(start1, start2);
        const e = Math.min(end1, end2);
        return Math.max(0, e - s);
    },

    calculateShift(shift, settings) {
        if (shift.type === 'OTHER' || (!shift.type)) return null;

        const rateLine = parseFloat(settings.rate) || 0; 
        const rateBase = rateLine / 1.12;                
        const rateRes  = rateBase * 1.08;                

        // Структура ответа
        let res = {
            net: 0, dirty: 0, hours: 0,
            parts: {
                tariffLine: { h: 0, m: 0 },
                tariffRes:  { h: 0, m: 0 },
                tariffBase: { h: 0, m: 0 },
                splitLine: { m: 0 }, splitRes: { m: 0 }, splitBase: { m: 0 },
                evLine: { h: 0, m: 0 }, evRes: { h: 0, m: 0 }, evBase: { h: 0, m: 0 },
                nightLine: { h: 0, m: 0 }, nightRes: { h: 0, m: 0 }, nightBase: { h: 0, m: 0 },
                class: 0, senior: 0, mentor: 0, tech: 0,
                sick: 0, vacation: 0, donor: 0, med: 0, study: 0
            },
            isSick: false, isVacation: false, isDonor: false
        };

        // БЛОК А: Спец. типы
        if (shift.type === 'SICK' || shift.type === 'VACATION' || shift.type === 'DONOR') {
            if (shift.type === 'SICK') { res.isSick = true; res.parts.sick = 1; } 
            if (shift.type === 'VACATION') { res.isVacation = true; res.parts.vacation = 1; }
            if (shift.type === 'DONOR') { res.isDonor = true; res.parts.donor = 1; }
            return res; 
        }

        // БЛОК Б: Интервалы
        const startMin = this.toMins(shift.startTime);
        const endMin = this.toMins(shift.endTime);
        
        // Если время кривое - выходим (вот тут раньше была ошибка!)
        if (startMin === null || endMin === null) return null;

        let totalMins = this.getDuration(startMin, endMin);
        if (shift.isPostTrip) totalMins += 10; 

        let lineMins = 0;
        let tpMins = 0;
        
        // 1. ТП
        if (shift.tpStart && shift.tpEnd) {
            tpMins = this.getDuration(this.toMins(shift.tpStart), this.toMins(shift.tpEnd));
        }

        // 2. Линия
        if (shift.isFullMedical) {
            lineMins = 0;
        } else if (shift.type === 'WORK' || shift.type === 'TRAINING' || shift.type === 'MED_CHECK') {
            lineMins = Math.max(0, totalMins - tpMins);
        } else if (shift.type === 'RESERVE') {
            if (shift.lineStart && shift.lineEnd) {
                lineMins = this.getDuration(this.toMins(shift.lineStart), this.toMins(shift.lineEnd));
            }
        }

        // 3. Остаток
        let remainderMins = Math.max(0, totalMins - lineMins - tpMins);
        let resMins = shift.isFullMedical ? 0 : remainderMins;
        if (shift.isFullMedical) tpMins += remainderMins;

        // БЛОК В: Тариф
        res.parts.tariffLine.h = lineMins / 60;
        res.parts.tariffLine.m = (lineMins / 60) * rateLine;

        res.parts.tariffRes.h = resMins / 60;
        res.parts.tariffRes.m = (resMins / 60) * rateRes;

        res.parts.tariffBase.h = tpMins / 60;
        res.parts.tariffBase.m = (tpMins / 60) * rateBase;

        res.hours = (lineMins + resMins + tpMins) / 60;

        // БЛОК Г: Время суток
        const calcBonus = (s, e, rate, codeType) => {
            if (s === null || e === null) return;
            const dur = this.getDuration(s, e);
            if (dur <= 0) return;

            const evMins = this.getIntersection(s, e, 1080, 1320); 
            if (evMins > 0) {
                const h = evMins / 60;
                res.parts['ev' + codeType].h += h;
                res.parts['ev' + codeType].m += h * rate * 0.20;
            }

            const nightMins = this.getIntersection(s, e, 1320, 1440) + this.getIntersection(s, e, 0, 360);      
            if (nightMins > 0) {
                const h = nightMins / 60;
                res.parts['night' + codeType].h += h;
                res.parts['night' + codeType].m += h * rate * 0.40;
            }
        };

        if (shift.tpStart && shift.tpEnd) {
            calcBonus(this.toMins(shift.tpStart), this.toMins(shift.tpEnd), rateBase, 'Base');
        }

        if (lineMins > 0) {
            if (shift.lineStart && shift.lineEnd) {
                calcBonus(this.toMins(shift.lineStart), this.toMins(shift.lineEnd), rateLine, 'Line');
            } else if (shift.type === 'WORK' || shift.type === 'TRAINING' || shift.type === 'MED_CHECK') {
                calcBonus(startMin, endMin, rateLine, 'Line');
            }
        }

        if (resMins > 0) {
            const totalNightMins = this.getIntersection(startMin, endMin, 1320, 1440) + this.getIntersection(startMin, endMin, 0, 360);
            const totalEvMins = this.getIntersection(startMin, endMin, 1080, 1320);

            const usedNightMins = (res.parts.nightLine.h * 60) + (res.parts.nightBase.h * 60);
            const usedEvMins = (res.parts.evLine.h * 60) + (res.parts.evBase.h * 60);

            const remNight = Math.max(0, totalNightMins - usedNightMins);
            const remEv = Math.max(0, totalEvMins - usedEvMins);
            
            const targetCode = shift.isFullMedical ? 'Base' : 'Res';
            const targetRate = shift.isFullMedical ? rateBase : rateRes;

            res.parts['night' + targetCode].h += remNight / 60;
            res.parts['night' + targetCode].m += (remNight / 60) * targetRate * 0.40;

            res.parts['ev' + targetCode].h += remEv / 60;
            res.parts['ev' + targetCode].m += (remEv / 60) * targetRate * 0.20;
        }

        // БЛОК Д: Разрыв
        if (shift.isSplit) {
            res.parts.splitLine.m = res.parts.tariffLine.m * 0.30;
            res.parts.splitRes.m  = res.parts.tariffRes.m * 0.30;
            res.parts.splitBase.m = res.parts.tariffBase.m * 0.30;
        }

        // БЛОК Е: Бонусы
        const tariffSum = res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m;
        
        if (settings.classP > 0) res.parts.class = tariffSum * (settings.classP / 100);
        
        const senP = this.getSeniorityPercent(settings.startDate);
        if (senP > 0) res.parts.senior = tariffSum * (senP / 100); // Это Выслуга

        if (settings.senior || shift.customSenior) {
            res.parts.senior += tariffSum * 0.10; // Это Ст. Машинист
        }

        if ((settings.mentor || shift.customMentor) && !shift.isFullMedical) {
            res.parts.mentor = res.parts.tariffLine.m * 0.15; 
            res.parts.mentor += res.parts.tariffRes.m * 0.15; 
        }

        if (shift.isTech) {
            res.parts.tech = 2 * rateLine;
        }

        if (shift.type === 'TRAINING') {
            res.parts.study = res.parts.tariffLine.m; res.parts.tariffLine.m = 0; res.parts.tariffLine.h = 0;
        }
        if (shift.type === 'MED_CHECK') {
            res.parts.med = res.parts.tariffLine.m; res.parts.tariffLine.m = 0; res.parts.tariffLine.h = 0;
        }

        // ИТОГО
        res.dirty = 
            res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m +
            res.parts.splitLine.m + res.parts.splitRes.m + res.parts.splitBase.m +
            res.parts.evLine.m + res.parts.evRes.m + res.parts.evBase.m +
            res.parts.nightLine.m + res.parts.nightRes.m + res.parts.nightBase.m +
            res.parts.class + res.parts.senior + res.parts.mentor + res.parts.tech +
            res.parts.study + res.parts.med;

        // == ИСПРАВЛЕНИЕ: Добавляем NET, чтобы карточка не была пустой ==
        // Используем упрощенный налог 13% + профсоюз, для отображения "На руки" на карточке
        const union = settings.union ? (res.dirty * 0.01) : 0;
        res.net = Math.round(res.dirty - (res.dirty * 0.13) - union);

        return res;
    },

    calculateOvertimePay(overtimeHours, settings) {
        if (overtimeHours <= 0) return { money15: 0, money20: 0, total: 0 };
        const rate = parseFloat(settings.rate) || 0; 
        let hours15 = (overtimeHours <= 2) ? overtimeHours : 2;
        let hours20 = (overtimeHours <= 2) ? 0 : overtimeHours - 2;
        return { 
            hours15, money15: hours15 * rate * 0.5, 
            hours20, money20: hours20 * rate * 1.0, 
            total: (hours15 * rate * 0.5) + (hours20 * rate * 1.0) 
        };
    },

    getSeniorityPercent(startDateStr) {
        if (!startDateStr) return 0;
        const start = new Date(startDateStr);
        const now = new Date();
        if (start > now) return 0; 
        const years = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
        if (years >= 20) return 30;
        if (years >= 15) return 25;
        if (years >= 10) return 20;
        if (years >= 5) return 15;
        if (years >= 3) return 10;
        return 5; 
    }
};