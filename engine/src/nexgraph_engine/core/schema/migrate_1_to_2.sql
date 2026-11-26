-- Nâng graph.db từ phiên bản 1 lên 2 (chỉ cộng thêm): kieu_bien, moc_tep, lan_lap_chi_muc.thu_muc_con.
CREATE TABLE kieu_bien (
    ma_nut INTEGER NOT NULL REFERENCES nut (ma_nut) ON DELETE CASCADE,
    ten    TEXT    NOT NULL CHECK (length(ten) BETWEEN 1 AND 255),
    kieu   TEXT    NOT NULL CHECK (length(kieu) BETWEEN 1 AND 255),
    PRIMARY KEY (ma_nut, ten)
);

CREATE TABLE moc_tep (
    duong_dan_tuong_doi TEXT NOT NULL PRIMARY KEY
                          CHECK (length(duong_dan_tuong_doi) BETWEEN 1 AND 1024
                                 AND duong_dan_tuong_doi NOT LIKE '/%'
                                 AND instr(duong_dan_tuong_doi, char(92)) = 0),
    ma_bam              TEXT NOT NULL CHECK (length(ma_bam) = 64 AND ma_bam NOT GLOB '*[^0-9a-f]*')
);

ALTER TABLE lan_lap_chi_muc ADD COLUMN thu_muc_con TEXT
    CHECK (thu_muc_con IS NULL OR length(thu_muc_con) BETWEEN 1 AND 1024);

UPDATE du_an SET phien_ban_schema = 2;
PRAGMA user_version = 2;
