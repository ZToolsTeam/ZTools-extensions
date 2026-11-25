/** 中国居民身份证性别枚举常量（UI 展示统一经 i18n 的 genderMale / genderFemale 翻译） */
export const CN_GENDER_MALE = '男' as const
export const CN_GENDER_FEMALE = '女' as const
export type CnGender = typeof CN_GENDER_MALE | typeof CN_GENDER_FEMALE
