-- ============================================
-- IMPROVED DATABASE SCHEMA
-- Booking Management System
-- ============================================

BEGIN;

-- Drop existing tables if needed (use with caution in production)
-- DROP TABLE IF EXISTS public.notifications CASCADE;
-- DROP TABLE IF EXISTS public.vendor_early_closures CASCADE;
-- DROP TABLE IF EXISTS public.vendor_holidays CASCADE;
-- DROP TABLE IF EXISTS public.reviews CASCADE;
-- DROP TABLE IF EXISTS public.vendor_metrics CASCADE;
-- DROP TABLE IF EXISTS public.booking_services CASCADE;
-- DROP TABLE IF EXISTS public.bookings CASCADE;
-- DROP TABLE IF EXISTS public.vendor_services CASCADE;
-- DROP TABLE IF EXISTS public.services_master CASCADE;
-- DROP TABLE IF EXISTS public.vendor_documents CASCADE;
-- DROP TABLE IF EXISTS public.vendor_shop_details CASCADE;
-- DROP TABLE IF EXISTS public.user_profiles CASCADE;
-- DROP TABLE IF EXISTS public.users CASCADE;

-- ============================================
-- USERS TABLE - Constant/Rarely Changed Data
-- ============================================
CREATE TABLE IF NOT EXISTS public.users
(
    user_id serial NOT NULL,
    phone_number character varying(15) COLLATE pg_catalog."default" NOT NULL,
    email character varying(100) COLLATE pg_catalog."default",
    password_hash character varying(255) COLLATE pg_catalog."default" NOT NULL,
    user_type character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'CUSTOMER'::character varying,
    -- Options: CUSTOMER, VENDOR, ADMIN, SUPERADMIN
    phone_verified boolean DEFAULT false,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer, -- For admin/superadmin tracking (who created this user)
    CONSTRAINT users_pkey PRIMARY KEY (user_id),
    CONSTRAINT users_phone_number_key UNIQUE (phone_number),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT check_user_type CHECK (user_type IN ('CUSTOMER', 'VENDOR', 'ADMIN', 'SUPERADMIN'))
);

CREATE INDEX IF NOT EXISTS idx_users_user_type ON public.users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- ============================================
-- USER PROFILES TABLE - Updatable Data (One-to-Many)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_profiles
(
    profile_id serial NOT NULL,
    user_id integer NOT NULL,
    name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    city character varying(50) COLLATE pg_catalog."default",
    state character varying(50) COLLATE pg_catalog."default",
    gender character varying(10) COLLATE pg_catalog."default",
    profile_picture text COLLATE pg_catalog."default",
    device_id character varying(255) COLLATE pg_catalog."default",
    fcm_token text COLLATE pg_catalog."default",
    last_login_at timestamp without time zone,
    is_current boolean DEFAULT true, -- Mark current active profile
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_profiles_pkey PRIMARY KEY (profile_id),
    CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_current ON public.user_profiles(user_id, is_current) WHERE is_current = true;

-- ============================================
-- VENDOR SHOP DETAILS
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_shop_details
(
    shop_id serial NOT NULL,
    user_id integer NOT NULL,
    shop_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    shop_address text COLLATE pg_catalog."default" NOT NULL,
    city character varying(50) COLLATE pg_catalog."default" NOT NULL,
    state character varying(50) COLLATE pg_catalog."default" NOT NULL,
    pincode character varying(10) COLLATE pg_catalog."default",
    shop_description text COLLATE pg_catalog."default",
    latitude numeric(10, 8),
    longitude numeric(11, 8),
    open_time time without time zone NOT NULL,
    close_time time without time zone NOT NULL,
    break_start_time time without time zone,
    break_end_time time without time zone,
    weekly_holiday character varying(10) COLLATE pg_catalog."default",
    no_of_seats integer NOT NULL DEFAULT 1,
    no_of_workers integer NOT NULL DEFAULT 1,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'pending'::character varying,
    -- Options: pending, approved, rejected
    admin_comments text COLLATE pg_catalog."default",
    verified_at timestamp without time zone,
    verified_by integer,
    business_license character varying(100) COLLATE pg_catalog."default",
    tax_number character varying(50) COLLATE pg_catalog."default",
    bank_account_number character varying(50) COLLATE pg_catalog."default",
    bank_ifsc_code character varying(20) COLLATE pg_catalog."default",
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    CONSTRAINT vendor_shops_pkey PRIMARY KEY (shop_id),
    CONSTRAINT vendor_shops_user_id_key UNIQUE (user_id),
    CONSTRAINT vendor_shops_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT vendor_shops_verified_by_fkey FOREIGN KEY (verified_by)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT check_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_shops_user_id ON public.vendor_shop_details(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_shops_status ON public.vendor_shop_details(status);
CREATE INDEX IF NOT EXISTS idx_vendor_shops_city ON public.vendor_shop_details(city);

-- ============================================
-- VENDOR DOCUMENTS (renamed from vendor_images)
-- Unified table for all vendor documents including images
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_documents
(
    document_id serial NOT NULL,
    vendor_id integer NOT NULL,
    document_url text COLLATE pg_catalog."default" NOT NULL,
    document_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    -- Options: shop_image, license, tax_certificate, id_proof, etc.
    is_primary boolean DEFAULT false,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'pending'::character varying,
    admin_comments text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT vendor_documents_pkey PRIMARY KEY (document_id),
    CONSTRAINT vendor_documents_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT check_document_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_documents_vendor_id ON public.vendor_documents(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_documents_type ON public.vendor_documents(document_type);

-- ============================================
-- SERVICES MASTER
-- ============================================
CREATE TABLE IF NOT EXISTS public.services_master
(
    service_id serial NOT NULL,
    service_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    service_description text COLLATE pg_catalog."default",
    default_duration_minutes integer DEFAULT 30,
    service_type character varying(20) COLLATE pg_catalog."default" DEFAULT 'normal'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT services_master_pkey PRIMARY KEY (service_id),
    CONSTRAINT services_master_service_name_key UNIQUE (service_name)
);

-- ============================================
-- VENDOR SERVICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_services
(
    vendor_service_id serial NOT NULL,
    vendor_id integer NOT NULL,
    service_id integer NOT NULL,
    price numeric(10, 2) NOT NULL,
    is_available boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT vendor_services_pkey PRIMARY KEY (vendor_service_id),
    CONSTRAINT vendor_services_vendor_service_key UNIQUE (vendor_id, service_id),
    CONSTRAINT vendor_services_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT vendor_services_service_id_fkey FOREIGN KEY (service_id)
        REFERENCES public.services_master (service_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendor_services_vendor_id ON public.vendor_services(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_services_service_id ON public.vendor_services(service_id);

-- ============================================
-- BOOKINGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.bookings
(
    booking_id serial NOT NULL,
    user_id integer NOT NULL,
    vendor_id integer NOT NULL,
    booking_date date NOT NULL,
    total_amount numeric(10, 2) NOT NULL,
    payment_method character varying(20) COLLATE pg_catalog."default",
    payment_status character varying(20) COLLATE pg_catalog."default" DEFAULT 'pending'::character varying,
    booking_status character varying(20) COLLATE pg_catalog."default" DEFAULT 'confirmed'::character varying,
    cancellation_reason text COLLATE pg_catalog."default",
    cancelled_by character varying(10) COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT bookings_pkey PRIMARY KEY (booking_id),
    CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT bookings_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor_id ON public.bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON public.bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(booking_status);

-- ============================================
-- BOOKING SERVICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.booking_services
(
    booking_service_id serial NOT NULL,
    booking_id integer NOT NULL,
    service_id integer NOT NULL,
    service_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    service_price numeric(10, 2) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    duration_minutes integer DEFAULT 30,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT booking_services_pkey PRIMARY KEY (booking_service_id),
    CONSTRAINT booking_services_booking_id_fkey FOREIGN KEY (booking_id)
        REFERENCES public.bookings (booking_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT booking_services_service_id_fkey FOREIGN KEY (service_id)
        REFERENCES public.services_master (service_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_booking_services_booking_id ON public.booking_services(booking_id);

-- ============================================
-- VENDOR METRICS (replaces rating columns in shop_details)
-- This table stores calculated/aggregated data
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_metrics
(
    metric_id serial NOT NULL,
    vendor_id integer NOT NULL,
    total_bookings integer DEFAULT 0,
    completed_bookings integer DEFAULT 0,
    cancelled_bookings integer DEFAULT 0,
    total_revenue numeric(12, 2) DEFAULT 0.00,
    average_rating numeric(3, 2) DEFAULT 0.00,
    total_reviews integer DEFAULT 0,
    last_booking_date date,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vendor_metrics_pkey PRIMARY KEY (metric_id),
    CONSTRAINT vendor_metrics_vendor_id_key UNIQUE (vendor_id),
    CONSTRAINT vendor_metrics_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendor_metrics_vendor_id ON public.vendor_metrics(vendor_id);

-- ============================================
-- REVIEWS
-- ============================================
CREATE TABLE IF NOT EXISTS public.reviews
(
    review_id serial NOT NULL,
    booking_id integer NOT NULL,
    user_id integer NOT NULL,
    vendor_id integer NOT NULL,
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT reviews_pkey PRIMARY KEY (review_id),
    CONSTRAINT reviews_booking_id_key UNIQUE (booking_id), -- One review per booking
    CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id)
        REFERENCES public.bookings (booking_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT reviews_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_vendor_id ON public.reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking_id ON public.reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);

-- ============================================
-- VENDOR HOLIDAYS
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_holidays
(
    holiday_id serial NOT NULL,
    vendor_id integer NOT NULL,
    holiday_date date NOT NULL,
    holiday_reason character varying(255) COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT vendor_holidays_pkey PRIMARY KEY (holiday_id),
    CONSTRAINT vendor_holidays_vendor_date_key UNIQUE (vendor_id, holiday_date),
    CONSTRAINT vendor_holidays_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendor_holidays_vendor_id ON public.vendor_holidays(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_holidays_date ON public.vendor_holidays(holiday_date);

-- ============================================
-- VENDOR EARLY CLOSURES
-- ============================================
CREATE TABLE IF NOT EXISTS public.vendor_early_closures
(
    closure_id serial NOT NULL,
    vendor_id integer NOT NULL,
    closure_date date NOT NULL,
    early_close_time time without time zone NOT NULL,
    reason text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT vendor_early_closures_pkey PRIMARY KEY (closure_id),
    CONSTRAINT vendor_early_closures_vendor_date_key UNIQUE (vendor_id, closure_date),
    CONSTRAINT vendor_early_closures_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendor_early_closures_vendor_id ON public.vendor_early_closures(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_early_closures_date ON public.vendor_early_closures(closure_date);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications
(
    notification_id serial NOT NULL,
    user_id integer,
    vendor_id integer,
    booking_id integer,
    notification_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    message text COLLATE pg_catalog."default" NOT NULL,
    is_read boolean DEFAULT false,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    status character varying(20) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
    CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT notifications_vendor_id_fkey FOREIGN KEY (vendor_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT notifications_booking_id_fkey FOREIGN KEY (booking_id)
        REFERENCES public.bookings (booking_id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_vendor_id ON public.notifications(vendor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- ============================================
-- TRIGGERS FOR AUTO-UPDATING TIMESTAMPS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all relevant tables
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_shop_details_updated_at BEFORE UPDATE ON vendor_shop_details 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_documents_updated_at BEFORE UPDATE ON vendor_documents 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_services_master_updated_at BEFORE UPDATE ON services_master 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_services_updated_at BEFORE UPDATE ON vendor_services 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_booking_services_updated_at BEFORE UPDATE ON booking_services 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_holidays_updated_at BEFORE UPDATE ON vendor_holidays 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_early_closures_updated_at BEFORE UPDATE ON vendor_early_closures 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_metrics_updated_at BEFORE UPDATE ON vendor_metrics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

BEGIN;

-- Insert a SUPERADMIN (password: admin123)
INSERT INTO users (phone_number, email, password_hash, user_type, phone_verified, created_by)
VALUES 
('9999999999', 'superadmin@admin.com', '$2a$10$YourHashedPasswordHere', 'SUPERADMIN', true, NULL);

-- Insert superadmin profile
INSERT INTO user_profiles (user_id, name, is_current)
VALUES (1, 'Super Admin', true);

-- Insert sample services
INSERT INTO services_master (service_name, service_description, default_duration_minutes)
VALUES 
('Haircut', 'Professional haircut service', 30),
('Hair Styling', 'Hair styling and treatment', 45),
('Shaving', 'Clean shave service', 20),
('Beard Trim', 'Beard trimming and styling', 15),
('Facial', 'Facial treatment', 60),
('Massage', 'Head and shoulder massage', 30);

COMMIT;
