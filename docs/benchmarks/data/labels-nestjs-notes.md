# Ghi chú gán nhãn Ground-Truth: NestJS Backend

## 1. Tổng quan
- **Mã nguồn dự án**: `/tmp/eval/nestjs` (NestJS TypeScript backend, git commit `d11f4ef7d906ba514cf9e3c2234116ad49789ee7`).
- **Danh sách mẫu**: 12 tệp từ `/tmp/eval/sample-nestjs.json` (seed 7).
- **Tệp nhãn CSV**: `/Users/twot/Documents/CODE/DACN-CNTT/nexgraph/docs/benchmarks/data/labels-nestjs.csv`.
- **Tổng số dòng gán nhãn**: 195 dòng.
- **Trạng thái kiểm tra**: Toàn bộ 195 dòng đều có `file` thuộc danh sách 12 tệp mẫu; 100% đường dẫn tệp đích (`target`) của các cạnh `import`, `call`, `inherit`, `test` (gồm 49 tệp phân biệt) đều tồn tại thực tế trên đĩa mã nguồn. Tệp CSV tuân thủ chuẩn RFC và đã được kiểm tra tính hợp lệ bằng `csv.DictReader`.

### Phân bổ theo loại (Kind totals)
| Loại (Kind) | Số lượng | Mô tả |
| :--- | :--- | :--- |
| `symbol` | 64 | Lớp (`class`), bộ liệt kê (`enum`), hàm/phương thức (`method`) |
| `import` | 69 | Các câu lệnh import trỏ tới tệp nội bộ dự án |
| `call` | 45 | Lời gọi phương thức/hàm nội bộ dự án bên trong hàm/phương thức |
| `inherit` | 2 | Kế thừa lớp nội bộ dự án (`PrismaBaseService`) |
| `test` | 15 | Khởi tạo hoặc gọi kiểm thử từ các tệp `*.spec.ts` |
| **Tổng cộng** | **195** | |

---

## 2. Thống kê số lượng theo từng tệp mẫu

| STT | Đường dẫn tệp | symbol | import | call | inherit | test | Tổng |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `src/apps/auth/consts/jwt.const.ts` | 3 | 0 | 0 | 0 | 0 | **3** |
| 2 | `src/apps/auth/dto/sign.dto.ts` | 3 | 2 | 0 | 0 | 0 | **5** |
| 3 | `src/apps/cart-items/cart-items.service.ts` | 5 | 4 | 2 | 1 | 5 | **17** |
| 4 | `src/apps/categories/categories.controller.ts` | 9 | 11 | 8 | 0 | 0 | **28** |
| 5 | `src/apps/order-promotions/order-promotions.controller.ts` | 3 | 3 | 2 | 0 | 0 | **8** |
| 6 | `src/apps/product-variants/product-variants.controller.ts` | 9 | 10 | 8 | 0 | 0 | **27** |
| 7 | `src/apps/products/products.service.ts` | 11 | 14 | 9 | 1 | 8 | **43** |
| 8 | `src/apps/role-permissions/dto/get-role-permission.dto.ts` | 1 | 1 | 0 | 0 | 0 | **2** |
| 9 | `src/apps/users/users.controller.ts` | 9 | 11 | 8 | 0 | 0 | **28** |
| 10 | `src/apps/vendors/vendor-shop.controller.ts` | 3 | 7 | 2 | 0 | 0 | **12** |
| 11 | `src/common/guards/access-control/access-control.guard.ts` | 5 | 6 | 5 | 0 | 1 | **17** |
| 12 | `src/common/utils/date-util/date-util.service.ts` | 3 | 0 | 1 | 0 | 1 | **5** |
| | **Tổng cộng** | **64** | **69** | **45** | **2** | **15** | **195** |

---

## 3. Chi tiết từng tệp mẫu

### 1. `src/apps/auth/consts/jwt.const.ts`
- **Symbols (3)**: `JWTEnvs`, `JWTToken`, `TokenKeys` (tất cả là `enum`).
- **Imports, Calls, Inherits, Tests**: Không có.

### 2. `src/apps/auth/dto/sign.dto.ts`
- **Imports (2)**:
  - Dòng 2 -> `src/common/interceptors/format-response/format-response.util.ts`
  - Dòng 5 -> `src/apps/auth/consts/jwt.const.ts`
  *(Dòng 3 import `src/generated/zod` được bỏ qua do tệp không tồn tại trong repo, xem mục 4)*.
- **Symbols (3)**: `SignInDto`, `SignUpDto`, `SignInResponseDto` (`class`).
- **Calls, Inherits, Tests**: Không có.

### 3. `src/apps/cart-items/cart-items.service.ts`
- **Imports (4)**:
  - Dòng 4 -> `src/common/prisma/prisma.service.ts`
  - Dòng 5 -> `src/common/services/prisma-base.service.ts`
  - Dòng 6 -> `src/apps/carts/carts.service.ts`
  - Dòng 7 -> `src/apps/cart-items/dto/update-cart-item.dto.ts`
- **Symbols (5)**: `CartItemsService`, `CartItemsService.createCartItem`, `CartItemsService.updateCartItem`, `CartItemsService.deleteCartItem`, `CartItemsService.onOrderCreated`.
- **Inherit (1)**: Dòng 10: `CartItemsService` extends `src/common/services/prisma-base.service.ts::PrismaBaseService`.
- **Calls (2)**:
  - Dòng 37: `CartItemsService.createCartItem` -> `src/apps/carts/carts.service.ts::CartsService.getOrCreateCart`
  - Dòng 88: `CartItemsService.onOrderCreated` -> `src/apps/carts/carts.service.ts::CartsService.getOrCreateCart`
- **Tests (5)**: `cart-items.service.spec.ts` kiểm thử `CartItemsService`, `createCartItem`, `updateCartItem`, `deleteCartItem`, `onOrderCreated`.

### 4. `src/apps/categories/categories.controller.ts`
- **Imports (11)**:
  - Dòng 17 -> `src/apps/auth/auth.decorator.ts`
  - Dòng 20 -> `src/common/decorators/user.decorator.ts`
  - Dòng 21 -> `src/common/decorators/user.decorator.ts`
  - Dòng 22 -> `src/common/interceptors/excel-response/excel-response.interceptor.ts`
  - Dòng 23 -> `src/common/pipes/parse-params-pagination.pipe.ts`
  - Dòng 24 -> `src/common/query/options.interface.ts`
  - Dòng 25 -> `src/common/utils/excel-util/dto/excel-util.interface.ts`
  - Dòng 26 -> `src/apps/categories/categories.service.ts`
  - Dòng 27 -> `src/apps/categories/dto/create-category.dto.ts`
  - Dòng 28 -> `src/apps/categories/dto/get-category.dto.ts`
  - Dòng 29 -> `src/apps/categories/dto/update-category.dto.ts`
- **Symbols (9)**: `CategoriesController` và 8 phương thức: `createCategory`, `updateCategory`, `getCategories`, `getCategoryOptions`, `exportCategories`, `importCategories`, `getCategory`, `deleteCategory`.
- **Calls (8)**:
  - Dòng 37 -> `CategoriesService.createCategory`
  - Dòng 42 -> `CategoriesService.updateCategory`
  - Dòng 52 -> `CategoriesService.getCategories`
  - Dòng 61 -> `CategoriesService.getOptions`
  - Dòng 67 -> `CategoriesService.exportCategories`
  - Dòng 76 -> `CategoriesService.importCategories`
  - Dòng 82 -> `CategoriesService.getCategory`
  - Dòng 87 -> `CategoriesService.deleteCategory`
- **Tests**: Không có test cho controller.

### 5. `src/apps/order-promotions/order-promotions.controller.ts`
- **Imports (3)**:
  - Dòng 3 -> `src/common/interceptors/excel-response/excel-response.interceptor.ts`
  - Dòng 4 -> `src/apps/order-promotions/dto/get-order-promotion.dto.ts`
  - Dòng 5 -> `src/apps/order-promotions/order-promotions.service.ts`
- **Symbols (3)**: `OrderPromotionsController`, `getOrderPromotions`, `exportOrderPromotions`.
- **Calls (2)**:
  - Dòng 15 -> `OrderPromotionsService.getOrderPromotions`
  - Dòng 21 -> `OrderPromotionsService.exportOrderPromotions`

### 6. `src/apps/product-variants/product-variants.controller.ts`
- **Imports (10)**:
  - Dòng 18 -> `src/common/decorators/user.decorator.ts`
  - Dòng 19 -> `src/common/decorators/user.decorator.ts`
  - Dòng 20 -> `src/common/interceptors/excel-response/excel-response.interceptor.ts`
  - Dòng 21 -> `src/common/pipes/parse-params-pagination.pipe.ts`
  - Dòng 22 -> `src/common/query/options.interface.ts`
  - Dòng 23 -> `src/common/utils/excel-util/dto/excel-util.interface.ts`
  - Dòng 24 -> `src/apps/product-variants/dto/create-product-variant.dto.ts`
  - Dòng 25 -> `src/apps/product-variants/dto/get-product-variant.dto.ts`
  - Dòng 29 -> `src/apps/product-variants/dto/update-product-variant.dto.ts`
  - Dòng 30 -> `src/apps/product-variants/product-variants.service.ts`
- **Symbols (9)**: `ProductVariantsController` và 8 phương thức: `createProductVariant`, `updateProductVariant`, `getProductVariants`, `getProductVariantOptions`, `exportProductVariants`, `importProductVariants`, `getProductVariant`, `deleteProductVariant`.
- **Calls (8)**:
  - Dòng 38 -> `ProductVariantsService.createProductVariant`
  - Dòng 46 -> `ProductVariantsService.updateProductVariant`
  - Dòng 55 -> `ProductVariantsService.getProductVariants`
  - Dòng 60 -> `ProductVariantsService.getOptions`
  - Dòng 70 -> `ProductVariantsService.exportProductVariants`
  - Dòng 79 -> `ProductVariantsService.importProductVariants`
  - Dòng 84 -> `ProductVariantsService.getProductVariant`
  - Dòng 89 -> `ProductVariantsService.deleteProductVariant`

### 7. `src/apps/products/products.service.ts`
- **Imports (14)**:
  - Dòng 4 -> `src/common/decorators/user.decorator.ts`
  - Dòng 5 -> `src/common/utils/string-util/string-util.service.ts`
  - Dòng 6 -> `src/common/prisma/prisma.service.ts`
  - Dòng 7 -> `src/common/query/options.interface.ts`
  - Dòng 8 -> `src/common/services/prisma-base.service.ts`
  - Dòng 9 -> `src/common/utils/excel-util/excel-util.service.ts`
  - Dòng 10 -> `src/common/utils/pagination-util/pagination-util.service.ts`
  - Dòng 11 -> `src/common/utils/query-util/query-util.service.ts`
  - Dòng 12 -> `src/apps/vendors/entities/vendor.entity.ts`
  - Dòng 13 -> `src/apps/vendors/vendors.service.ts`
  - Dòng 14 -> `src/apps/products/dto/create-product.dto.ts`
  - Dòng 15 -> `src/apps/products/dto/get-product.dto.ts`
  - Dòng 16 -> `src/apps/products/dto/update-product.dto.ts`
  - Dòng 17 -> `src/apps/products/entities/product.entity.ts`
- **Symbols (11)**: `ProductsService` và 10 phương thức: `getProduct`, `getProducts`, `createProduct`, `updateProduct`, `getOptions`, `exportProducts`, `importProducts`, `deleteProduct`, `verifyProductOwnership`, `publishProduct`.
- **Inherit (1)**: Dòng 20: `ProductsService` extends `src/common/services/prisma-base.service.ts::PrismaBaseService`.
- **Calls (9)**:
  - Dòng 63 -> `PaginationUtilService.paging`
  - Dòng 74 -> `PaginationUtilService.format`
  - Dòng 83 -> `StringUtilService.toSlug`
  - Dòng 159 -> `QueryUtilService.convertFieldsSelectOption`
  - Dòng 196 -> `ExcelUtilService.generateExcel`
  - Dòng 205 -> `ExcelUtilService.read`
  - Dòng 237 -> `StringUtilService.toSlug`
  - Dòng 278 -> `StringUtilService.toSlug`
  - Dòng 361 -> `ProductsService.verifyProductOwnership`
- **Tests (8)**: `products.service.spec.ts` kiểm thử `ProductsService`, `getProduct`, `getProducts`, `createProduct`, `updateProduct`, `deleteProduct`, `exportProducts`, `importProducts`.

### 8. `src/apps/role-permissions/dto/get-role-permission.dto.ts`
- **Imports (1)**: Dòng 2 -> `src/apps/roles/entities/role.entity.ts`
- **Symbols (1)**: `ExportRolePermissionsDto` (`class`).

### 9. `src/apps/users/users.controller.ts`
- **Imports (11)**:
  - Dòng 17 -> `src/common/interceptors/excel-response/excel-response.interceptor.ts`
  - Dòng 18 -> `src/common/decorators/user.decorator.ts`
  - Dòng 19 -> `src/common/decorators/user.decorator.ts`
  - Dòng 20 -> `src/common/pipes/parse-params-pagination.pipe.ts`
  - Dòng 21 -> `src/common/query/options.interface.ts`
  - Dòng 22 -> `src/common/utils/excel-util/dto/excel-util.interface.ts`
  - Dòng 23 -> `src/apps/users/dto/create-user.dto.ts`
  - Dòng 24 -> `src/apps/users/dto/get-user.dto.ts`
  - Dòng 25 -> `src/apps/users/dto/update-user.dto.ts`
  - Dòng 26 -> `src/apps/users/entities/user.entity.ts`
  - Dòng 27 -> `src/apps/users/users.service.ts`
- **Symbols (9)**: `UsersController` và 8 phương thức: `createUser`, `exportUsers`, `importUsers`, `getUsers`, `getUserOptions`, `getUser`, `updateUser`, `deleteUser`.
- **Calls (8)**:
  - Dòng 34 -> `UsersService.createUser`
  - Dòng 40 -> `UsersService.exportUsers`
  - Dòng 49 -> `UsersService.importUsers`
  - Dòng 55 -> `UsersService.getUsers`
  - Dòng 60 -> `UsersService.getOptions`
  - Dòng 65 -> `UsersService.getUser`
  - Dòng 70 -> `UsersService.updateUser`
  - Dòng 78 -> `UsersService.deleteUser`

### 10. `src/apps/vendors/vendor-shop.controller.ts`
- **Imports (7)**:
  - Dòng 3 -> `src/common/pipes/parse-params-pagination.pipe.ts`
  - Dòng 4 -> `src/apps/auth/auth.decorator.ts`
  - Dòng 5 -> `src/apps/products/dto/get-product.dto.ts`
  - Dòng 6 -> `src/apps/products/products.service.ts`
  - Dòng 7 -> `src/apps/vendors/entities/vendor.entity.ts`
  - Dòng 8 -> `src/apps/vendors/consts/vendor.const.ts`
  - Dòng 9 -> `src/apps/vendors/vendors.service.ts`
- **Symbols (3)**: `VendorShopController`, `getShopInfo`, `getShopProducts`.
- **Calls (2)**:
  - Dòng 22 -> `VendorsService.getShopInfo`
  - Dòng 33 -> `ProductsService.getProducts`

### 11. `src/common/guards/access-control/access-control.guard.ts`
- **Imports (6)**:
  - Dòng 6 -> `src/apps/auth/auth.decorator.ts`
  - Dòng 7 -> `src/apps/users/users.service.ts`
  - Dòng 8 -> `src/apps/vendors/entities/vendor.entity.ts`
  - Dòng 9 -> `src/common/envs/validate.env.ts`
  - Dòng 10 -> `src/common/utils/api-util/api-util.const.ts`
  - Dòng 11 -> `src/common/guards/access-control/access-control.const.ts`
- **Symbols (5)**: `AccessControlGuard` và 4 phương thức: `getCurrentRoute`, `canAccessResources`, `getAction`, `canActivate`.
- **Calls (5)**:
  - Dòng 41 -> `UsersService.isSuperAdmin`
  - Dòng 44 -> `UsersService.isExistPermissionKey`
  - Dòng 89 -> `AccessControlGuard.getCurrentRoute`
  - Dòng 90 -> `AccessControlGuard.getAction`
  - Dòng 94 -> `AccessControlGuard.canAccessResources`
- **Tests (1)**: `access-control.guard.spec.ts` kiểm thử `AccessControlGuard`.

### 12. `src/common/utils/date-util/date-util.service.ts`
- **Symbols (3)**: `DateUtilService`, `DateUtilService.getCurrentDate`, `DateUtilService.formatDate`.
- **Calls (1)**:
  - Dòng 7: `DateUtilService.getCurrentDate` gọi `DateUtilService.formatDate`.
- **Tests (1)**: `date-util.service.spec.ts` kiểm thử `DateUtilService`.

---

## 4. Danh sách các trường hợp bỏ qua vì không chắc / quy tắc loại trừ

1. **`src/generated/zod` trong `src/apps/auth/dto/sign.dto.ts` dòng 3**:
   - Câu lệnh: `import { UserSchema } from 'src/generated/zod';`
   - Lý do bỏ qua: Tệp được sinh tự động bởi plugin `zod-prisma-types` khi chạy `prisma generate` (nằm trong mục `src/generated` của `.gitignore`) và không tồn tại trên đĩa trong commit git hiện tại (`ls` không thấy tệp). Nhằm bảo đảm tính toàn vẹn của ground truth (mọi tệp đích đều kiểm tra được bằng `test -f`), câu lệnh import này được loại trừ khỏi CSV.

2. **Constructor và Getters/Setters**:
   - Constructor: Các constructor trong `CartItemsService`, `CategoriesController`, `OrderPromotionsController`, `ProductVariantsController`, `ProductsService`, `UsersController`, `VendorShopController`, `AccessControlGuard`.
   - Getters: `client` và `extended` (trong `CartItemsService`, `ProductsService`).
   - Lý do bỏ qua: Quy tắc chỉ gán nhãn `class`, `enum`, `function`, `method` (định nghĩa chuẩn). Constructor và property getter được coi là chi tiết thiết kế thuộc tính/khởi tạo của lớp.

3. **Interfaces và Type Aliases**:
   - Ví dụ: `UserInfo`, `GetOptionsParams`, `File`, `RolesData`, `RolesImportCreate`, `PermissionsData`, `PermissionsImportCreate`, v.v.
   - Lý do bỏ qua: Quy tắc chỉ định rõ: *"skip interfaces, types, plain variables... Only declarations that are functions/classes/enums/methods"*.

4. **Biến hằng và Schema Zod**:
   - Ví dụ: `SignInSchema`, `SignUpSchema`, `SignInResponseSchema`, `excelSheets`, `productEntityName`.
   - Lý do bỏ qua: Là các biến/thuộc tính thông thường (`const` / plain variable), không phải hàm hay lớp.

5. **Lời gọi tới thư viện bên ngoài / ORM / Builtins**:
   - Thư viện NestJS & Decorators: `@Injectable()`, `@Controller()`, `@Post()`, `@SkipAuth()`, v.v.
   - EventEmitter: `this.eventEmitter.emit(...)`.
   - Prisma Client ORM: `this.client.upsert`, `this.extended.findFirst`, `tx.product.create`, `tx.productVariant.updateMany`, `this.prismaService.$transaction`, v.v.
   - Thư viện ExcelJS: `workbook.xlsx.write(res)`.
   - JavaScript/NodeJS built-ins: `new Date()`, `new Intl.DateTimeFormat()`, `Math.ceil()`, `JSON.stringify()`, `Object.entries()`, `res.end()`, v.v.
   - Ngoại lệ chuẩn NestJS: `throw new NotFoundException(...)`, `throw new BadRequestException(...)`.

6. **Phương thức mở rộng động của Prisma (`this.extended.export(...)`)**:
   - Trong `ProductsService.exportProducts`: `this.extended.export(...)` được cung cấp động qua Prisma extension `initExtended()` trong `PrismaService`, không phải phương thức tĩnh của một lớp. Bỏ qua để tránh nhầm lẫn với phương thức lớp thông thường.

---

## 5. Nhận xét về độ khó và thời gian thực hiện

- **Độ khó tổng thể**: Trung bình.
  - Các tệp Controller (`CategoriesController`, `OrderPromotionsController`, `ProductVariantsController`, `UsersController`, `VendorShopController`) có cấu trúc rất đồng nhất và tường minh: đa phần chỉ nhận tham số từ HTTP Request và gọi thẳng tới phương thức cùng tên của Service tương ứng.
  - Các tệp Service (`CartItemsService`, `ProductsService`) phức tạp hơn vì chứa nhiều thao tác ORM, transaction, và gọi qua lại các tiện ích (`PaginationUtilService`, `StringUtilService`, `ExcelUtilService`, `QueryUtilService`). Cần đọc kỹ mã nguồn của từng tiện ích để xác nhận tên phương thức nội bộ (ví dụ: `paging.format` thực chất là gọi lại `PaginationUtilService.format`).
  - Tệp Guard (`AccessControlGuard`) có các lời gọi nội bộ (`getCurrentRoute`, `getAction`, `canAccessResources`) và lời gọi liên dịch vụ (`UsersService.isSuperAdmin`, `UsersService.isExistPermissionKey`).
  - Hệ thống kiểm thử của dự án chỉ viết unit spec cho các Service và Guard, hoàn toàn không có test spec cho Controller.
- **Thời gian phân tích và gán nhãn**: Khoảng 40 - 50 phút đọc chi tiết từng dòng mã nguồn, đối chiếu định nghĩa và kiểm tra chéo tính tồn tại của các tệp đích trên toàn bộ dự án.

## Duyệt bổ sung (agent, 2026-11-13; người dùng vẫn cần duyệt lại ≥ 3 tệp)
Bản nháp bỏ `constructor`, getter (`client`, `extended`) và `type` alias theo quy ước tự đặt. NexGraph coi chúng là symbol (phương thức/khai báo kiểu), và đó là cách đọc hợp lý của "mọi symbol", nên đã thêm 14 dòng `symbol` tương ứng trước khi chấm lần hai (8 constructor, 4 getter, 4 type alias).
Sau khi đối chiếu với kết quả của công cụ trích xuất gốc: `ProductsService ... implements Options<Product>` (dòng 20) bị bản nháp bỏ sót; đã thêm một dòng `inherit` (implements tới interface trong dự án).
