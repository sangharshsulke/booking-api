# 🪒 Saloon Booking App — संपूर्ण प्रोजेक्ट माहिती (मराठी)

> **हे डॉक्युमेंट संपूर्णपणे मराठीत लिहिले आहे.**
> Project चा प्रत्येक भाग सोप्या भाषेत समजावला आहे — API, Database, Flutter App, आणि System Design.

---

## 📌 प्रोजेक्ट म्हणजे काय?

हा एक **Saloon / Barber Shop Booking App** आहे — जसे Zomato मध्ये जेवण बुक करतो, तसे या app मध्ये **केस कापण्यासाठी / beauty services साठी appointment बुक** करता येते.

### तीन प्रकारचे users आहेत:

| User Type | काम |
|-----------|-----|
| **Customer** | Saloon शोधणे, appointment बुक करणे, review देणे |
| **Vendor** | Saloon चालवणे, bookings manage करणे, services add करणे |
| **Admin / SuperAdmin** | Platform manage करणे, vendors approve/reject करणे |

---

## 🏗️ System Design — प्रोजेक्ट कसा बांधला आहे?

### मोठ्या दृष्टिकोनातून पाहिले तर:

```
📱 Flutter App (Mobile)
        ↕ HTTPS API calls
🖥️ Node.js Server (Backend API)
        ↕ SQL queries
🗄️ PostgreSQL Database (Data Storage)
        ↕ Push Notifications
🔥 Firebase (OTP Auth + FCM Push)
```

---

## 🔧 Backend — Node.js API (booking-api फोल्डर)

### हा काय करतो?
- **Express.js** framework वापरतो — म्हणजे हा एक web server आहे जो API requests handle करतो
- Port **3000** वर चालतो
- **JWT Token** वापरून security ठेवतो

### फाईल्स आणि त्यांचे काम:

```
booking-api/
├── server.js           ← सर्व routes इथे register होतात (मुख्य दरवाजा)
├── routes/             ← कोणता URL कोणत्या controller कडे जाईल
│   ├── authRoutes.js       ← Login / Register
│   ├── customerRoutes.js   ← Customer चे सर्व काम
│   ├── vendorRoute.js      ← Vendor चे सर्व काम
│   └── adminRoutes.js      ← Admin चे सर्व काम
├── controllers/        ← प्रत्येक API चे actual logic
│   ├── authController.js
│   ├── customerController.js
│   ├── vendorController.js
│   └── adminController.js
├── middleware/
│   └── auth.js         ← JWT token check करतो (security guard)
├── config/
│   ├── database.js     ← PostgreSQL connection
│   └── firebase.js     ← Firebase Admin SDK
└── database/
    ├── schema.sql      ← Database tables बनवण्याचे SQL
    └── seed.sql        ← Sample data
```

---

## 🗄️ Database Design — PostgreSQL

### Database म्हणजे काय?
Database म्हणजे एक **डिजिटल रजिस्टर** जिथे सर्व माहिती साठवली जाते.

### प्रत्येक Table (रजिस्टर) काय साठवतो:

---

### 1. `users` — सर्व users ची यादी
```
user_id | phone_number    | email              | user_type  | status
--------|-----------------|---------------------|------------|-------
1       | +919999999999   | admin@admin.com    | SUPERADMIN | active
2       | +918765432109   | suresh@gmail.com   | VENDOR     | active
3       | +919876543210   | rahul@gmail.com    | CUSTOMER   | active
```
- **CUSTOMER** — app वापरणारा सामान्य माणूस
- **VENDOR** — saloon चा मालक
- **ADMIN** — platform चा admin
- **SUPERADMIN** — सर्वोच्च अधिकारी (admin बनवू शकतो)

---

### 2. `user_profiles` — users ची वैयक्तिक माहिती
```
profile_id | user_id | name          | city   | fcm_token        | device_id
-----------|---------|---------------|--------|------------------|----------
1          | 3       | Rahul Patil   | Pune   | FCM_TOKEN_123... | phone_abc
```
- `fcm_token` — push notification पाठवण्यासाठी
- `device_id` — एकाच वेळी दोन devices वर login रोखण्यासाठी (Security Feature!)
- `is_current` — सर्वात नवीन profile कोणती?

---

### 3. `vendor_shop_details` — Saloon ची माहिती
```
shop_id | user_id | shop_name        | city   | open_time | close_time | status
--------|---------|------------------|--------|-----------|------------|--------
1       | 2       | Style Hub Salon  | Nagpur | 09:00     | 20:00      | approved
```
- `weekly_holiday` — आठवड्यात कोणत्या दिवशी बंद (उदा. Sunday)
- `no_of_seats` — किती जण एकावेळी बसू शकतात
- `status` — **pending** (admin ने अजून बघितले नाही) / **approved** / **rejected**
- `latitude, longitude` — Map वर saloon कुठे आहे

---

### 4. `services_master` — सर्व services ची यादी
```
service_id | service_name  | default_duration_minutes
-----------|---------------|-------------------------
1          | Haircut       | 30
2          | Shaving       | 20
3          | Beard Trim    | 15
4          | Facial        | 60
5          | Massage       | 30
```
Admin हे services बनवतो. Vendor त्यातून आपल्या shop साठी निवडतो.

---

### 5. `vendor_services` — Vendor ने कोणत्या services ऑफर कराव्यात
```
vendor_service_id | vendor_id | service_id | price  | is_available
------------------|-----------|------------|--------|-------------
1                 | 2         | 1          | 150.00 | true
2                 | 2         | 2          | 80.00  | true
```
- एकाच service चे वेगवेगळ्या saloon मध्ये वेगळे दर असतात
- `is_available` — service तात्पुरती बंद करता येते

---

### 6. `bookings` — Appointments ची नोंद
```
booking_id | user_id | vendor_id | booking_date | booking_status | total_amount
-----------|---------|-----------|--------------|----------------|-------------
1          | 3       | 2         | 2026-06-25   | confirmed      | 230.00
```
Booking statuses:
- `confirmed` — appointment fix झाली
- `completed` — service दिली गेली
- `cancelled` — रद्द केली

---

### 7. `booking_services` — एका booking मध्ये कोणत्या services
```
booking_service_id | booking_id | service_name | price  | start_time | end_time
-------------------|------------|--------------|--------|------------|----------
1                  | 1          | Haircut      | 150.00 | 10:00      | 10:30
2                  | 1          | Shaving      | 80.00  | 10:30      | 10:50
```
एका appointment मध्ये multiple services बुक करता येतात!

---

### 8. `reviews` — Customers चे reviews
```
review_id | booking_id | user_id | vendor_id | rating | review_text
----------|------------|---------|-----------|--------|------------------
1         | 1          | 3       | 2         | 5      | "खूप छान केस कापले!"
```
- Rating: 1 ते 5 stars
- एका booking साठी एकच review (unique)

---

### 9. `vendor_holidays` — Saloon बंद असेल त्या दिवसांची नोंद
```
holiday_id | vendor_id | holiday_date | holiday_reason
-----------|-----------|--------------|----------------
1          | 2         | 2026-07-04   | Ashadhi Ekadashi
```

---

### 10. `vendor_early_closures` — लवकर बंद होण्याची वेळ
```
closure_id | vendor_id | closure_date | early_close_time | reason
-----------|-----------|--------------|------------------|------------------
1          | 2         | 2026-06-28   | 16:00            | Family function
```

---

### 11. `notifications` — Push Notifications ची नोंद
```
notification_id | user_id | booking_id | title              | is_read
----------------|---------|------------|--------------------|---------
1               | 3       | 1          | Booking Confirmed! | false
```

---

### 12. `vendor_metrics` — Vendor ची stats (auto-calculated)
```
vendor_id | total_bookings | completed_bookings | average_rating | total_revenue
----------|----------------|--------------------|----------------|---------------
2         | 150            | 120                | 4.5            | 18500.00
```

---

### 13. `vendor_documents` — Documents आणि Images
```
document_id | vendor_id | document_url        | document_type     | status
------------|-----------|---------------------|-------------------|--------
1           | 2         | /uploads/shop_1.jpg | shop_profile_image | active
2           | 2         | /uploads/license.pdf | license          | pending
```
- `shop_profile_image` — मुख्य फोटो
- `shop_gallery_image` — इतर फोटो
- `license` — दुकानाचा परवाना

---

## 🔐 Authentication — Login कसे काम करते?

### OTP-based Login (Main Flow):

```
1. Customer फोन नंबर टाकतो
        ↓
2. Firebase (Google चे service) OTP पाठवते
        ↓
3. Customer OTP टाकतो → App Firebase token मिळवते
        ↓
4. Backend ला firebase_token + phone_number पाठवते
        ↓
5. Backend Firebase token verify करते
        ↓
6. Backend JWT Token तयार करून देते
        ↓
7. App हा JWT Token वापरून पुढे सर्व APIs call करते
```

### JWT Token म्हणजे काय?
- JWT = JSON Web Token
- हा एक **डिजिटल ओळखपत्र** आहे
- प्रत्येक API call मध्ये `Authorization: Bearer TOKEN` header मध्ये पाठवावा लागतो
- Token 70 दिवस valid असतो

### Device ID Security (Special Feature!):
- एकाच account वर दोन phones वर login रोखण्यासाठी
- नवीन device वर login केले तर जुन्या device वर **Force Logout notification** येते
- हे Google/Netflix सारखे काम करते

---

## 📱 Flutter App — Mobile Application

### Flutter म्हणजे काय?
Flutter हे Google चे framework आहे जे एकाच codebase मधून **Android आणि iOS दोन्ही** साठी app बनवते.

### App चे Pages (Screens):

**Authentication:**
- `SelectUserTypeScreen` — Customer की Vendor?
- `LoginScreen` — Phone number टाका
- `OTPVerificationScreen` — OTP verify करा
- `RegisterCustomerScreen` — नवीन customer नोंदणी
- `VendorOnboardingScreen` — नवीन vendor नोंदणी (multi-step)

**Customer साठी:**
- `CustomerHomeScreen` — Home dashboard (upcoming bookings, favourite shops)
- `ExploreScreen` — आजूबाजूचे shops शोधा
- `ShopDetailScreen` — Shop ची पूर्ण माहिती, services, photos
- `BookingConfirmationScreen` — Service निवडा, वेळ निवडा, confirm करा
- `CustomerBookingsScreen` — माझ्या सर्व bookings
- `BookingDetailScreen` — एका booking ची संपूर्ण माहिती

**Vendor साठी:**
- `VendorDashboardScreen` — आजच्या bookings, revenue stats
- `VendorBookingsScreen` — येणाऱ्या bookings manage करा
- `ServicesScreen` — माझ्या services manage करा
- `VendorMediaScreen` — Photos आणि documents upload करा
- `BlockTimeScreen` — Holiday किंवा early closure mark करा
- `ProfileScreen` — Shop आणि profile settings
- `OutletDetailsScreen` — Shop ची पूर्ण माहिती edit करा

**Special Screens:**
- `VendorPendingApprovalScreen` — Admin ने अजून approve केले नाही
- `VendorRejectedScreen` — Admin ने reject केले
- `OfflineBookingScreen` — Walk-in customers साठी manual booking
- `NotificationScreen` — सर्व notifications

---

### Flutter Architecture — BLoC Pattern

Flutter app **BLoC (Business Logic Component)** pattern वापरतो. हे MVC pattern सारखेच आहे.

```
Screen (UI) → BLoC (Logic) → Repository → API → Server
```

उदाहरण (Booking flow):
```
BookingConfirmationScreen
    → BookingBloc event: CreateBooking(services, date, time)
        → BookingRepository.createBooking()
            → ApiClient.post('/customer/bookings', data)
                → Server returns success
            → BookingBloc state: BookingSuccess
        → Screen shows "Booking Confirmed!" ✅
```

---

### Flutter मधील Key Services:

**`firebase_auth_service.dart`** — Firebase OTP handle करतो
**`session_manager.dart`** — JWT token save/delete करतो
**`device_service.dart`** — Device ID track करतो
**`fcm_service.dart`** — Push notifications receive करतो
**`auth_interceptor.dart`** — प्रत्येक API call मध्ये automatically JWT token add करतो

---

## 🌐 API List — संपूर्ण API यादी

### 🔐 Auth APIs (`/api/auth`)

| Method | URL | काम |
|--------|-----|-----|
| POST | `/auth/send-otp` | OTP पाठवणे (user exists check) |
| POST | `/auth/verify-otp` | OTP verify + Login/Register |
| POST | `/auth/check-user` | Phone नंबर registered आहे का? |
| POST | `/auth/register` | Legacy: password registration |
| POST | `/auth/login` | Legacy: password login |
| GET | `/auth/profile` | माझी profile पाहणे |
| PUT | `/auth/profile` | माझी profile update करणे |
| POST | `/auth/logout` | Logout |

---

### 👤 Customer APIs (`/api/customer`) — JWT Required

| Method | URL | काम |
|--------|-----|-----|
| GET | `/customer/dashboard/stats` | Dashboard stats |
| GET | `/customer/shops` | सर्व shops यादी |
| GET | `/customer/shops/:id` | एका shop ची माहिती |
| GET | `/customer/shops/:id/available-slots` | Available time slots |
| POST | `/customer/bookings` | नवीन booking |
| GET | `/customer/bookings` | माझ्या bookings |
| GET | `/customer/bookings/:id` | एका booking ची माहिती |
| PUT | `/customer/bookings/:id/cancel` | Booking रद्द करणे |
| POST | `/customer/reviews` | Review देणे |
| GET | `/customer/categories` | सर्व categories |
| GET | `/customer/notifications` | Notifications |
| PUT | `/customer/notifications/:id/read` | Notification read mark |
| PUT | `/customer/notifications/read-all` | सर्व read mark |
| PUT | `/customer/fcm-token` | FCM token update |

---

### 🏪 Vendor APIs (`/api/vendor`) — Vendor JWT Required

| Method | URL | काम |
|--------|-----|-----|
| GET | `/vendor/profile` | Vendor profile |
| PUT | `/vendor/profile` | Profile update |
| GET | `/vendor/shop` | Shop details |
| POST | `/vendor/shop` | Shop तयार करणे |
| PUT | `/vendor/shop` | Shop update |
| PUT | `/vendor/shop/operating-hours` | वेळ बदलणे |
| PUT | `/vendor/shop/capacity` | Seats/workers update |
| POST | `/vendor/block-time` | Holiday/Early closure |
| GET | `/vendor/block-time` | Blocked times list |
| DELETE | `/vendor/block-time/:id` | Block time delete |
| POST | `/vendor/shop/profile-image` | Main photo upload |
| POST | `/vendor/shop/gallery-images` | Gallery photos upload |
| GET | `/vendor/shop/images` | सर्व images |
| DELETE | `/vendor/shop/images/:id` | Image delete |
| PUT | `/vendor/shop/images/:id/primary` | Primary image set |
| GET | `/vendor/documents` | Documents |
| POST | `/vendor/documents` | Document upload |
| DELETE | `/vendor/documents/:id` | Document delete |
| GET | `/vendor/dashboard/stats` | Dashboard stats |
| GET | `/vendor/services/master` | सर्व available services |
| GET | `/vendor/services` | माझ्या services |
| POST | `/vendor/services` | Service add करणे |
| POST | `/vendor/custom-service` | Custom service |
| POST | `/vendor/services/bulk` | Multiple services add |
| PUT | `/vendor/services/:id` | Service price update |
| PATCH | `/vendor/services/:id/availability` | On/Off toggle |
| DELETE | `/vendor/services/:id` | Service delete |
| POST | `/vendor/bookings/offline` | Walk-in booking |
| GET | `/vendor/bookings` | सर्व bookings |
| GET | `/vendor/bookings/:id` | Booking details |
| PUT | `/vendor/bookings/:id/accept` | Booking accept |
| PUT | `/vendor/bookings/:id/reject` | Booking reject |
| PUT | `/vendor/bookings/:id/complete` | Booking complete |
| PUT | `/vendor/bookings/:id/no-show` | No-show mark |
| GET | `/vendor/reviews` | माझे reviews |
| GET | `/vendor/notifications` | Notifications |
| PUT | `/vendor/notifications/:id/read` | Read mark |
| PUT | `/vendor/fcm-token` | FCM token |

---

### 👑 Admin APIs (`/api/admin`) — Admin JWT Required

| Method | URL | काम |
|--------|-----|-----|
| GET | `/admin/dashboard/stats` | Platform stats |
| GET | `/admin/users` | सर्व users |
| GET | `/admin/users/:id` | एका user ची माहिती |
| PUT | `/admin/users/:id/status` | Block/Unblock user |
| DELETE | `/admin/users/:id` | User delete |
| POST | `/admin/users/admin` | नवीन admin तयार (SuperAdmin only) |
| GET | `/admin/vendors` | सर्व vendors |
| GET | `/admin/vendors/:id` | एका vendor ची माहिती |
| PUT | `/admin/vendors/:id/verification` | Approve/Reject vendor |
| GET | `/admin/vendors/:id/documents` | Vendor documents |
| PUT | `/admin/documents/:id/verification` | Document approve/reject |
| GET | `/admin/services` | Master services list |
| POST | `/admin/services` | नवीन service तयार |
| PUT | `/admin/services/:id` | Service update |
| DELETE | `/admin/services/:id` | Service delete |
| GET | `/admin/categories` | Categories list |
| POST | `/admin/categories` | Category तयार |
| PUT | `/admin/categories/:id` | Category update |
| GET | `/admin/bookings` | सर्व platform bookings |
| POST | `/admin/bookings` | Admin booking तयार |
| PUT | `/admin/bookings/:id/status` | Status update |
| PUT | `/admin/bookings/:id/cancel` | Cancel |
| POST | `/admin/send-notification` | Push notification पाठवणे |

---

## ⏰ Slot Calculation — Time Slots कसे काम करतात?

हे सर्वात important feature आहे!

**Customer ने 2026-06-25 ला slot बघितले तर:**

```
System खालील गोष्टी check करते:
1. Shop open आहे का त्या दिवशी? (weekly_holiday check)
2. Holiday आहे का? (vendor_holidays table)
3. Early closure आहे का? (vendor_early_closures table)
4. त्या दिवशी आधीच कोणाच्या bookings आहेत? (bookings table)
5. Break time आहे का? (break_start_time, break_end_time)

→ Available slots = Shop hours - (Existing bookings + Holidays + Break)
```

**उदाहरण:**
```
Shop: 9:00 AM - 8:00 PM (11 hours × 2 slots/hour = 22 possible slots)
Already booked: 10:00, 10:30, 14:00
Break time: 1:00 PM - 2:00 PM

Available: 9:00, 9:30, 11:00, 11:30, 12:00, 12:30, 2:00, 2:30... etc.
```

---

## 🔔 Push Notifications — FCM कसे काम करते?

**FCM = Firebase Cloud Messaging** — Google चे free push notification service

### Notification कधी येतात?

| Event | Customer ला | Vendor ला |
|-------|-------------|-----------|
| Booking confirmed | ✅ "Booking confirmed!" | ✅ "New booking received!" |
| Booking cancelled | ✅ "Booking cancelled" | ✅ "Customer cancelled" |
| Booking completed | ✅ "Service completed!" | ✅ "Booking marked complete" |
| Vendor approved | — | ✅ "Your shop is approved!" |
| Vendor rejected | — | ✅ "Verification failed" |
| New device login | ✅ "Force logout" | ✅ "Force logout" |

---

## 🖼️ File Upload — Images कुठे जातात?

Images आणि documents **server वरच साठवले जातात:**

```
booking-api/
└── uploads/
    └── shops/
        ├── shop-1774151096017-148897778.jpg   ← Shop photo
        ├── shop-1774274312482-668717226.jpg   ← Gallery photo
        └── shop-1777129538982-850981703.pdf   ← License document
```

Files `multer` package वापरून upload होतात.

URL बनतो: `http://server-ip:3000/uploads/shops/filename.jpg`

---

## 🔄 Booking Lifecycle — Booking कसे manage होते?

```
Customer books appointment
        ↓
Status: CONFIRMED ← default
        ↓
    Vendor ने accept केले → CONFIRMED (already)
    Vendor ने reject केले → REJECTED
        ↓
Service झाली → Vendor: COMPLETE करतो
Customer आला नाही → Vendor: NO-SHOW mark करतो
Customer ने रद्द केले → CANCELLED
        ↓
Customer review देतो (only completed bookings)
        ↓
Vendor metrics automatically update होतात
```

---

## 📊 Vendor Dashboard — काय दाखवतो?

Vendor च्या dashboard मध्ये:
- **आजचे bookings** — किती appointments आहेत
- **Total revenue** — एकूण कमाई
- **Average rating** — सरासरी review rating
- **Completed vs Cancelled** — performance stats
- **Recent bookings list** — नवीन appointments

---

## 🛡️ Security Features

1. **JWT Token** — प्रत्येक API call secure करतो (70 दिवस valid)
2. **Device ID Check** — एकाच वेळी एकाच device वर login
3. **Role-based Access** — Customer, Vendor, Admin यांना वेगळ्या permissions
4. **Firebase OTP** — Phone number verify करतो (fake numbers रोखतो)
5. **Soft Delete** — Data खरोखर delete नाही होत, `deleted_at` timestamp set होतो
6. **Status Check** — Blocked users API access करू शकत नाहीत

---

## 🚀 Server कसा चालवायचा?

```bash
# 1. Dependencies install करा
cd booking-api
npm install

# 2. .env file setup करा
PORT=3000
DB_HOST=localhost
DB_NAME=booking_db
DB_USER=postgres
DB_PASSWORD=yourpassword
JWT_SECRET=your_secret_key

# 3. Database setup करा
psql -U postgres -c "CREATE DATABASE booking_db;"
psql -U postgres -d booking_db -f database/schema.sql
psql -U postgres -d booking_db -f database/seed.sql

# 4. Server start करा
npm start
# किंवा development mode साठी:
npm run dev

# Server चालू झाला: http://localhost:3000
# Health check: http://localhost:3000/health
```

---

## 📱 Flutter App चे Dependencies (pubspec.yaml)

App मध्ये खालील packages वापरले आहेत:
- `flutter_bloc` — State management (BLoC pattern)
- `firebase_auth` — OTP authentication
- `firebase_messaging` — Push notifications
- `flutter_local_notifications` — Device वर notification दाखवणे
- `geolocator` — GPS location (shop nearby दाखवण्यासाठी)
- `sqflite` — Local database (offline data)
- `shared_preferences` — JWT token save करणे
- `connectivity_plus` — Internet connection check
- `file_picker` — Document upload
- `dio` / `http` — API calls

---

## 🗺️ System Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│                   FLUTTER APP (Mobile)                │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Customer │  │  Vendor  │  │   Admin Panel    │  │
│  │  Screens │  │  Screens │  │   (Web/App)      │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                  │             │
│  ┌────▼──────────────▼──────────────────▼──────────┐ │
│  │              BLoC (State Management)             │ │
│  └────────────────────┬─────────────────────────────┘ │
│                       │                               │
│  ┌────────────────────▼─────────────────────────────┐ │
│  │           Repositories (API calls)               │ │
│  │  auth_repo | customer_repo | vendor_repo         │ │
│  └────────────────────┬─────────────────────────────┘ │
└───────────────────────┼──────────────────────────────┘
                        │ HTTPS (REST API)
                        ▼
┌──────────────────────────────────────────────────────┐
│              NODE.JS EXPRESS SERVER                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │   Auth   │  │ Customer │  │  Vendor | Admin  │  │
│  │  Routes  │  │  Routes  │  │  Routes          │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                  │             │
│  ┌────▼──────────────▼──────────────────▼──────────┐ │
│  │              Controllers (Business Logic)        │ │
│  └────────────────────┬─────────────────────────────┘ │
│                       │                               │
│  ┌────────────────────▼─────────────────────────────┐ │
│  │              Middleware                           │ │
│  │  verifyToken | isVendor | isAdmin | isSuperAdmin │ │
│  └────────────────────┬─────────────────────────────┘ │
└───────────────────────┼──────────────────────────────┘
                        │ SQL Queries
                        ▼
┌──────────────────────────────────────────────────────┐
│              POSTGRESQL DATABASE                      │
│                                                      │
│  users | user_profiles | vendor_shop_details         │
│  services_master | vendor_services                   │
│  bookings | booking_services                         │
│  reviews | vendor_metrics                            │
│  vendor_holidays | vendor_early_closures             │
│  notifications | vendor_documents                    │
└──────────────────────────────────────────────────────┘
                        
         ┌──────────────────────────────────┐
         │         FIREBASE (Google)         │
         │  OTP Auth (Phone Verification)   │
         │  FCM (Push Notifications)        │
         └──────────────────────────────────┘
```

---

## 🎯 Simple Summary — एका ओळीत सांगायचे तर

> **"हा एक Saloon Booking System आहे जिथे customers online appointment बुक करतात, vendors (saloon owners) त्या manage करतात, आणि admin पूर्ण platform control करतो — OTP login, JWT security, Firebase push notifications, आणि smart time slot calculation सह."**

---

## ✅ Postman Collection वापरण्याची पद्धत

1. `Saloon_Booking_POSTMAN_Collection.json` file Postman मध्ये **Import** करा
2. **Variables** set करा:
   - `baseUrl` = `http://localhost:3000/api`
3. **Auth API** → `Verify OTP + Login` call करा (BYPASS_TOKEN_ वापरा testing साठी)
4. Token automatically `customerToken` / `vendorToken` variable मध्ये save होईल
5. आता बाकी सर्व APIs test करता येतील!

---

*📅 Document तयार केले: June 2026 | Project: Saloon Management v1.0.0*
