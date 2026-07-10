export const ROLE_REGEX = /^\[(.+?)\]\s*(.*)$/;

export const CN_CHAPTER_HEADER = /^#{0,3}\s*第[零一二三四五六七八九十百千\d]+[章节回部卷篇集幕][：:\s]*(.*)$/;
export const EN_CHAPTER_HEADER = /^#{0,3}\s*(Chapter|Part|Section|Volume|Act|Ch\.?)\s+\d+[：:\s]*(.*)$/i;
export const MD_CHAPTER_HEADER = /^#{1,4}\s+(.+)$/;

export const DEFAULT_CHAPTER_TITLE = '正文';
export const SPLIT_MAX_LENGTH = 500;
