# Bộ nhận diện & Logo phần mềm NexGraph

> **Dự án:** Đồ án chuyên ngành HUTECH (HK1 2026–2027)  
> **Sản phẩm:** NexGraph — Nền tảng đồ thị tri thức phân tích & khám phá mã nguồn  
> **Khẩu hiệu:** *"Connecting Code. Revealing Knowledge."* (Kết nối mã nguồn. Khám phá tri thức.)

---

## 1. Ý nghĩa biểu trưng (Design Concept)

Logo NexGraph được thiết kế dựa trên sự giao thoa giữa **Nexus** (mối liên kết trung tâm) và **Knowledge Graph** (đồ thị tri thức mã nguồn):

1. **Khối hình học chữ "N" vững chắc:** Đường nét chính tạo nên chữ cái **N** (đại diện cho *NexGraph* và *Nexus*), thể hiện sức mạnh cấu trúc, sự liền mạch từ mã nguồn gốc đến tri thức tổng quan.
2. **Cấu trúc Đồ thị Tri thức (Knowledge Graph Topology):**
   - Không chỉ là chữ cái đơn thuần, biểu tượng là một mạng lưới đồ thị thực thụ gồm các **nút (nodes)** và **cạnh liên kết (edges)** có hướng.
   - Trọng tâm ở giữa là **Nexus Hub** (Nút trung tâm tỏa sáng), nơi hội tụ các luồng phụ thuộc và giải phóng tri thức qua trợ lý AI và công cụ phân tích.
3. **Không gian đa chiều (Hypergraph / 3D Octahedron):**
   - Các đỉnh vệ tinh phía trên (Kiến trúc/Mô-đun) và phía dưới (Kiểm thử/Xác minh) tạo thành một khối lăng trụ không gian 3 chiều đối xứng hoàn hảo qua trục tung `x=256`, tượng trưng cho khả năng phân tích đa tầng (Multi-tier code intelligence).

---

## 2. Bảng màu & Ánh xạ Design Tokens

Màu sắc của các nút và cạnh liên kết tuân thủ chính xác bảng **Design Tokens** của NexGraph (`styles.css`):

| Thành phần | Token | Hex Code | Ý nghĩa trong phần mềm |
|---|---|---|---|
| **Nền biểu tượng** | `--night` | `#12183a` | Giao diện chàm đêm chủ đạo, phong cách developer tool hiện đại |
| **Nút Trái-Dưới** | `--teal` | `#0a9c99` | Nút Mã nguồn / Hàm & Phương thức (Function/Method AST) |
| **Nút Trái-Trên** | `--blue` | `#3257f0` | Nút Kiến trúc / Lớp đối tượng (Class/Component Architecture) |
| **Nexus Hub (Trung tâm)** | `--violet` | `#7a4df2` | Trung tâm kết nối / Trợ lý AI / Canvas tri thức |
| **Nút Phải-Dưới** | `--magenta` | `#e23d94` | Nút Luồng xử lý / Vùng ảnh hưởng (Execution Flow & Blast Radius) |
| **Nút Phải-Trên** | `--amber` | `#e0a100` | Nút Báo cáo / Tài liệu tổng quan (Document & Report Knowledge) |
| **Nút Vệ tinh Đáy** | `--green` | `#1c9a5b` | Nút Kiểm thử liên quan / Đã xác minh (Verified Tests & Evidence) |

---

## 3. Danh mục tệp logo bàn giao

Các tệp được lưu trữ tại `design/logo/` và đồng bộ vào `nexgraph/design/logo/`:

1. **`nexgraph-app-icon.svg` & `nexgraph-app-icon.png` (512×512):**
   - Biểu tượng ứng dụng desktop chuẩn phong cách macOS Squircle / Windows App Icon.
   - Đã được sao chép vào `nexgraph/apps/desktop/build/icon.png` để phục vụ đóng gói installer (`.dmg`, `.exe`).
2. **`nexgraph-mark.svg` & `nexgraph-mark.png` (332×412, Nền trong suốt):**
   - Biểu tượng đồ thị vector độc lập không nền.
   - Thích hợp làm favicon, biểu tượng thanh menu, avatar GitHub repo, watermark hoặc slide thuyết trình.
3. **`nexgraph-3d-icon.png` & `nexgraph-3d-icon.webp` (1254×1254 px, 3D Render):**
   - Phiên bản biểu tượng 3D tạo bằng mô hình sinh ảnh: hiệu ứng kính mờ (frosted glassmorphism squircle), các quả cầu pha lê phát quang sinh học (bioluminescent crystal nodes) và ống laser lượng tử tạo thành chữ "N" cùng tâm Nexus phát nổ hạt ánh sáng.
   - Thích hợp cho ảnh bìa lớn, slide mở đầu thuyết trình, website landing page hoặc bài đăng truyền thông.
4. **`nexgraph-prism-logo.png` & `nexgraph-prism-logo.webp` (1254×1254 px, Origami Prism 3D):**
   - Thiết kế lăng trụ tinh thể gấp khúc (Crystalline Origami Prism): kết hợp giữa kim loại titan xước mờ (brushed titanium) và các mặt lăng kính lưỡng sắc khúc xạ dải quang phổ (dichroic prism facets) từ Electric Cyan sang Magenta/Violet.
   - Tại các đỉnh góc nhọn là các điểm nút dữ liệu lượng tử tí hon phát sáng. Mang phong cách công nghệ cao, sắc sảo, hiện đại và cấu trúc kiến trúc vững chắc.
5. **`nexgraph-hypercube-logo.png` & `nexgraph-hypercube-logo.webp` (1254×1254 px, Quantum Hypercube 3D + Wordmark):**
   - Thiết kế khối siêu lập phương lượng tử (Quantum Tesseract / Hypercube): cấu trúc lăng trụ tinh thể không gian 4 chiều với lõi năng lượng vũ trụ (radiant cosmic nexus orb) phát tỏa mạng lưới vi mạch đồ thị và các nút lập phương pha lê.
   - Chữ "N" bằng kim loại titan đen mờ nguyên khối cắt chéo phía trước, tích hợp kèm chữ thương hiệu "NexGraph" phát sáng phản chiếu trên mặt sàn. Thích hợp làm poster, banner chính của repo hoặc slide giới thiệu lớn.
6. **`nexgraph-minimal-logo.png` & `nexgraph-minimal-logo.webp` (1254×1254 px, Minimal Fluid Ribbon):**
   - Thiết kế tối giản tinh tế (Ultra-minimalist Fluid Ribbon): dải ruy-băng liên tục uốn lượn mượt mà tạo hình chữ "N" với 2 nút đồ thị tròn ở hai đầu.
   - Nền tối chàm đơn sắc không chi tiết rườm rà, dải màu gradient mềm mại từ Electric Cyan sang Magenta. Dễ nhận diện ngay lập tức ở mọi kích thước từ 16px đến khổ lớn.
7. **`nexgraph-dag-logo.png` & `nexgraph-dag-logo.webp` (1254×1254 px, Authentic Directed Graph / DAG):**
   - Thiết kế chuẩn đồ thị kỹ thuật (Authentic Directed Acyclic Graph - DAG): mô phỏng chính xác cấu trúc đồ thị luồng gọi hàm (`CALLS`), phân nhánh điều kiện, hợp nhất luồng và phụ thuộc mã nguồn (`IMPORTS`).
   - Các đỉnh tròn (nodes) có kích cỡ phân cấp theo vai trò (điểm vào `entrypoint`, lớp, hàm con), kết nối bằng các cạnh có mũi tên chỉ hướng (directed edges). Toàn bộ mạng lưới đồ thị sắp đặt tạo nên chữ "N" trên nền chàm đêm phẳng không chi tiết thừa.
8. **`nexgraph-logo-dark.svg` & `nexgraph-logo-dark.png` (840×220):**
   - Bản phối ngang (Horizontal lockup) trên nền tối (`--night`), gồm Biểu tượng + Chữ "NexGraph" + Tagline + Huy hiệu phiên bản `v0.2.0`.
   - Dùng cho website, tài liệu README trên GitHub, màn hình chờ splash screen.
9. **`nexgraph-logo-light.svg` & `nexgraph-logo-light.png` (840×220):**
   - Bản phối ngang trên nền sáng/trắng tinh tế.
   - Dùng cho bìa báo cáo đồ án Word/PDF (`bao-cao/`), slide bảo vệ trước hội đồng, tài liệu in ấn học thuật.
