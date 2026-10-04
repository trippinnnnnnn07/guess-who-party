# ตั้งค่า Supabase และ Google Login

## โปรเจกต์ที่สร้างในงานนี้

- ชื่อ: **guess-who-party**
- Project ref: `aumpursevjbclcdnadoo`
- Region: Singapore (`ap-southeast-1`)
- [เปิด Dashboard](https://supabase.com/dashboard/project/aumpursevjbclcdnadoo)
- ตารางและ private bucket ถูกสร้างแล้ว พร้อมหมวด อนิเมะ หนัง กีฬา และโจทย์ตัวอย่างสมมติ 3 ข้อ
- ไม่ต้องรัน migration เริ่มต้นซ้ำในโปรเจกต์นี้

## 1. คีย์เชื่อมต่อ

ไฟล์ `.env` อยู่ที่ root ของโปรเจกต์ `guess-who-party` (ไม่ใช่ใน client หรือ server) เซิร์ฟเวอร์อ่านให้อัตโนมัติ และ Git ไม่ติดตามไฟล์นี้

```dotenv
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
QUIZ_DEMO_MODE=false
```

เปิด **Project Settings → API Keys** ใช้ Publishable key (`sb_publishable_...`) และ Secret key (`sb_secret_...`) คนละตัว ห้ามนำ secret key ใส่ใน publishable key หรือ `VITE_*` รองรับ legacy service_role ผ่าน `SUPABASE_SERVICE_ROLE_KEY` เพื่อความเข้ากันได้ แต่แนะนำคีย์ใหม่

ตรวจการเชื่อมต่อด้วย `npm run db:check` คำสั่งนี้อ่านข้อมูลเท่านั้นและไม่แสดงคีย์ หากเปลี่ยน `.env` ให้รีสตาร์ตเซิร์ฟเวอร์

## 2. เปิด Google Login — เจ้าของบัญชีต้องทำส่วนนี้

1. เข้า [Google Cloud Console](https://console.cloud.google.com/) เลือกหรือสร้างโปรเจกต์ของคุณ
2. เปิด Google Auth Platform ตั้งค่า Branding/Audience/Data Access สำหรับการเข้าสู่ระบบ ใช้ข้อมูลพื้นฐาน `openid`, `email`, `profile` เท่านั้น ไม่ขอ Drive/Gmail
3. สร้าง OAuth Client ประเภท **Web application**
4. Authorized JavaScript origins: เพิ่ม `http://localhost:5173`, `http://localhost:3001` และ URL เว็บ Render จริง ถ้าใช้ preview ในงานนี้ให้เพิ่ม `http://localhost:3014` ด้วย
5. Authorized redirect URIs: ใส่ **Supabase callback** ต่อไปนี้ (ไม่ใช่ URL เว็บเกม):

   `https://aumpursevjbclcdnadoo.supabase.co/auth/v1/callback`

6. คัดลอก Google Client ID และ Client Secret ไปใส่ใน **Supabase → Authentication → Sign In / Providers → Google** แล้วเปิดใช้งานและบันทึก ห้ามใส่ Google Client Secret ลงใน React หรือส่งในแชต
7. **Supabase → Authentication → URL Configuration**:
   - Site URL: URL เว็บจริงเมื่อ deploy แล้ว; ช่วงพัฒนาใช้ `http://localhost:5173`
   - Redirect URLs: เพิ่ม `http://localhost:5173`, `http://localhost:3001`, `http://localhost:3014` และ URL เว็บ Render จริงที่ใช้ ไม่ใช้ wildcard กว้างใน production
8. ถ้า Google app ยังอยู่ใน Testing ให้เพิ่มบัญชีของคุณ/ผู้ทดสอบใน Test users ตามการตั้งค่า Audience ก่อนเปิดให้คนทั่วไปใช้ให้ตรวจข้อกำหนด Publishing/Verification ของ Google
9. เปิดเว็บเกม กด **เข้าสู่ระบบด้วย Google** เลือกบัญชี แล้วต้องกลับหน้าเกมพร้อมชื่อสมาชิก โดยไม่มี error

คู่มือทางการ: [Supabase Google Login](https://supabase.com/docs/guides/auth/social-login/auth-google)

## 3. แต่งตั้งแอดมินอย่างชัดเจน

ไม่มีการให้สิทธิ์บัญชีแรกอัตโนมัติ หลังเจ้าของเข้าสู่ระบบ Google สำเร็จ เปิด Supabase Authentication → Users ตรวจว่าเป็นบัญชีที่ต้องการ แล้วคัดลอก User UID

เจ้าของโปรเจกต์รันใน SQL Editor โดยแทนค่าด้วย UID ที่ตรวจแล้ว:

```sql
insert into public.quiz_admins(user_id)
values ('REPLACE_WITH_VERIFIED_USER_UUID')
on conflict (user_id) do nothing;
```

รีเฟรชเว็บเพื่อให้เห็นหน้าแอดมิน ห้ามใช้ `user_metadata` เป็นตัวบอกสิทธิ์ และอย่าให้ผู้เล่นเข้าถึง SQL Editor หรือ Secret key

## 4. ทดสอบครบเส้นทาง

1. สมาชิกสร้างโจทย์ เลือกหมวด ใส่ชื่อ/เรื่อง/รูปทั้ง 4 ตัว เฉลย คำใบ้ และเหตุผล แล้วบันทึกฉบับร่าง
2. ส่งตรวจ → แอดมินตรวจและอนุมัติ หรือส่งกลับพร้อมเหตุผล
3. โฮสต์สร้างห้อง เลือกหมวดและจำนวนข้อให้พอ เปิดอีก browser profile เข้าร่วม แล้วเริ่มเกม
4. ลองตอบช่วงแรก ขอคำใบ้ ตอบช่วงสอง ตอบซ้ำ รีเฟรช และดูคะแนนตอนเฉลย
5. โจทย์ของสมาชิกที่ล็อกอินในห้องถูกตัดออกตอนสุ่ม ถ้าทดสอบโจทย์ที่ตัวเองสร้าง ให้ใช้ผู้เล่นทดสอบบัญชีอื่น หรือโจทย์ตัวอย่างที่เตรียมไว้
6. แก้โจทย์ที่อนุมัติแล้ว → ต้องไม่ถูกสุ่มจนกว่าจะตรวจใหม่

## 5. โปรเจกต์ Supabase ใหม่ในอนาคต

ใช้โปรเจกต์ว่างเท่านั้น รัน SQL จาก `supabase/migrations/202610040001_quiz.sql` หนึ่งครั้ง แล้วรัน `supabase/seed.sql` หากต้องการโจทย์ตัวอย่าง ห้ามรัน migration นี้ซ้ำหรือใช้เป็นเครื่องมือล้างฐานข้อมูล

ตารางอยู่ใน public schema แต่เปิด RLS และ **ไม่ grant ให้ anon/authenticated** ออกแบบให้ Express อ่านด้วย service_role/secret key และตรวจสิทธิ์เอง ส่วน Security Advisor อาจแจ้ง `RLS Enabled No Policy` เป็น INFO ซึ่งเป็นการปิดการเข้าถึงโดยตั้งใจ ไม่ควรแก้ด้วย policy `using(true)` ดู [คำอธิบายของ Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

## 6. ขึ้น Render

- Node.js 22+ (แนะนำ 24)
- Build: `npm ci --include=dev && npm run build`
- Start: `npm start`
- เพิ่มตัวแปร Supabase ทั้ง 3 ตัวใน Render Environment, ตั้ง `NODE_ENV=production`, `QUIZ_DEMO_MODE=false`, `CLIENT_ORIGIN=https://YOUR_SITE.onrender.com`
- ไม่ push `.env` ขึ้น Git และไม่ตั้ง Secret key ด้วยชื่อที่ขึ้นต้น `VITE_`
- อย่าลืมเพิ่ม URL เว็บจริงใน Google/Supabase ตามข้อ 2
- เว็บ/Socket.IO ยังอยู่บน Render ฐานข้อมูลและรูปสมาชิกอยู่ Supabase; ห้องที่กำลังเล่นหายเมื่อ Node รีสตาร์ต
