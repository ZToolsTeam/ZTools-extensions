import type { MockSingleItem, MockUserRecord } from './types.js';
export declare function isLeapYear(year: number): boolean;
/**
 * 计算国家标准 GB 11643-1999 18位身份证末位校验码
 */
export declare function calculateIdCardCheckDigit(first17: string): string;
/**
 * 严格核验 18 位身份证号（包含闰年 2月29日 与末位加权模 11 校验位）
 */
export declare function verifyIdCard(idCard: string): boolean;
/**
 * 生成 100% 符合 GB 11643-1999 校验算法的虚拟 18 位二代居民身份证号
 */
export declare function generateValidIdCard(options?: {
    seed?: number;
    year?: number;
    month?: number;
    day?: number;
}): {
    idCard: string;
    areaName: string;
    birthDate: string;
    gender: '男' | '女';
};
/**
 * 计算国家标准 GB 32100-2015 统一社会信用代码第 18 位校验字符（模 31 加权算法）
 */
export declare function calculateCreditCodeCheckChar(first17: string): string;
/**
 * 严格核验 18 位统一社会信用代码（GB 32100-2015）
 */
export declare function verifyCreditCode(code: string): boolean;
export declare function generateValidCreditCode(seed?: number): string;
/**
 * 计算 ISO/IEC 7812 Luhn 银行卡末位模 10 校验码
 */
export declare function calculateLuhnCheckDigit(partialCard: string): number;
/**
 * 验证银行卡号是否通过 Luhn 算法
 */
export declare function verifyBankCardLuhn(cardNo: string): boolean;
export declare function generateValidBankCard(seed?: number): {
    cardNo: string;
    bankName: string;
};
export declare function generateValidMobilePhone(seed?: number): string;
export declare function generateMockSingleItems(seed?: number): MockSingleItem[];
export declare function generateMockBatchUsers(count?: number, seed?: number): MockUserRecord[];
