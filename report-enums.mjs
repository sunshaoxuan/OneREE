/**
 * 报告项枚举：与 i18n 键名对应，便于多语言与独立发行。
 * analyzer.mjs 写入 JSON；前端 app.js 用 t() 显示。
 * 变更类型 (MODIFIED/ADDED/DELETED) 仍用稳定字符串存 JSON，界面用 type_* 键翻译。
 */

/** requirement 列 / requirementKey 字段 */
export const RequirementKey = {
    HASH_MODIFIED: 'req_hash_modified',
    BINARY_CHANGED: 'req_binary_changed',
    NEW_SOURCE: 'req_new_source',
    NEW_BINARY: 'req_new_binary',
    STANDARD_REMOVED: 'req_standard_removed'
};

/** detailedAnalysis 条目（对象形式） */
export const DetailKey = {
    HASH_MISMATCH: 'detail_hash_mismatch',
    CODE_COMPARE_HINT: 'detail_code_compare_hint',
    DECOMPILE_FAILED: 'detail_decompile_failed'
};
