# SSH Commit Signing

ByteRover hỗ trợ ký commit bằng SSH key. Khi được bật, mỗi commit sẽ được đính kèm chữ ký số và hiển thị trạng thái **Verified** trên ByteRover.

---

## 1. Tạo SSH key (nếu chưa có)

Khuyến nghị dùng Ed25519 — nhỏ gọn và bảo mật hơn RSA.

```bash
ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519_signing
```

- `-C` là comment gắn vào key (thường là email).
- `-f` chỉ định tên file. Bạn có thể dùng key hiện có (`~/.ssh/id_ed25519`) nếu đã có.

Lệnh trên tạo ra 2 file:

| File | Vai trò |
|---|---|
| `~/.ssh/id_ed25519_signing` | Private key — **giữ bí mật** |
| `~/.ssh/id_ed25519_signing.pub` | Public key — đăng ký vào ByteRover |

---

## 2. Đăng ký public key lên ByteRover

```bash
brv signing-key add --key ~/.ssh/id_ed25519_signing --title "My laptop"
```

- `--key` nhận cả private key (`.` không có đuôi) hoặc public key (`.pub`).
- `--title` là nhãn để phân biệt các thiết bị khác nhau (mặc định lấy comment trong key).

Kiểm tra key đã đăng ký:

```bash
brv signing-key list
```

Kết quả trả về `Fingerprint` — dùng để đối chiếu khi cần xoá.

---

## 3. Cấu hình brv để dùng key ký

Trỏ brv đến private key:

```bash
brv vc config user.signingkey ~/.ssh/id_ed25519_signing
```

Bật tự động ký tất cả commit:

```bash
brv vc config commit.sign true
```

Từ đây mỗi `brv vc commit` sẽ tự động ký, không cần thêm flag.

---

## 4. Ký thủ công một commit (tùy chọn)

Nếu chưa bật `commit.sign`, vẫn có thể ký từng commit bằng flag:

```bash
brv vc commit -m "feat: add feature" --sign
```

---

## 5. Kiểm tra cấu hình hiện tại

```bash
brv vc config user.signingkey   # xem đường dẫn key đang dùng
brv vc config commit.sign       # xem trạng thái tự động ký
```

---

## Nếu đã cấu hình SSH signing trong git

Nếu bạn đã chạy `git config gpg.format ssh` và `git config user.signingKey ...`, brv có thể import trực tiếp:

```bash
brv vc config --import-git-signing
```

Lệnh này đọc `user.signingKey` và `commit.gpgSign` từ git config hệ thống và áp vào brv — không cần set thủ công.

---

## Xoá key không còn dùng

```bash
brv signing-key list              # lấy key ID
brv signing-key remove <key-id>   # xoá
```

---

## Tóm tắt luồng thiết lập

```
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_signing
    ↓
brv signing-key add --key ~/.ssh/id_ed25519_signing --title "My laptop"
    ↓
brv vc config user.signingkey ~/.ssh/id_ed25519_signing
    ↓
brv vc config commit.sign true
    ↓
brv vc commit -m "..." → tự động ký ✅
```
