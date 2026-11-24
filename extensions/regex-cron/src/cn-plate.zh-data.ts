/** 中国大陆车牌正则及合法/非法示例数据 */
export const CN_LICENSE_PLATE_PATTERN =
  '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z](?:[A-HJ-NP-Z0-9]{4}[A-HJ-NP-Z0-9挂学警港澳]|[DF][A-HJ-NP-Z0-9]\\d{4}|\\d{5}[DF])$'

export const CN_LICENSE_PLATE_VALID_EXAMPLES: string[] = ['京AD12345', '粤B8899A', '沪AF01234', '浙A12345D']
export const CN_LICENSE_PLATE_INVALID_EXAMPLES: string[] = ['京IO12345', '美A12345', '粤B123']
