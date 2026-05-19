--
-- PostgreSQL database dump
--

\restrict 6QdN8oX22A9ci2VNT67VaDkiVxHISwCwGQtOrm0qDfjmCpU9ZoMxT9ACdOQwnWn

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.vendors DROP CONSTRAINT IF EXISTS vendors_vendor_type_id_fkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_vendor_id_fkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_user_type_id_fkey;
ALTER TABLE IF EXISTS ONLY public.skus DROP CONSTRAINT IF EXISTS skus_sku_type_id_fkey;
ALTER TABLE IF EXISTS ONLY public.skus DROP CONSTRAINT IF EXISTS skus_parent_sku_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sku_vendor_assocs DROP CONSTRAINT IF EXISTS sku_vendor_assocs_vendor_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sku_vendor_assocs DROP CONSTRAINT IF EXISTS sku_vendor_assocs_sku_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.password_resets DROP CONSTRAINT IF EXISTS password_resets_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.locations DROP CONSTRAINT IF EXISTS locations_vendor_id_fkey;
ALTER TABLE IF EXISTS ONLY public.locations DROP CONSTRAINT IF EXISTS locations_secondary_contact_id_fkey;
ALTER TABLE IF EXISTS ONLY public.locations DROP CONSTRAINT IF EXISTS locations_principal_contact_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contacts DROP CONSTRAINT IF EXISTS contacts_vendor_id_fkey;
ALTER TABLE IF EXISTS ONLY public.change_log DROP CONSTRAINT IF EXISTS change_log_actor_user_id_fkey;
DROP INDEX IF EXISTS public.idx_vendors_gst_unique;
DROP INDEX IF EXISTS public.idx_vendor_types_name_ci;
DROP INDEX IF EXISTS public.idx_users_employee_id;
DROP INDEX IF EXISTS public.idx_users_email_ci;
DROP INDEX IF EXISTS public.idx_tps_name_ci;
DROP INDEX IF EXISTS public.idx_sva_unique;
DROP INDEX IF EXISTS public.idx_sku_types_name_ci;
DROP INDEX IF EXISTS public.idx_change_log_time;
DROP INDEX IF EXISTS public.idx_change_log_object;
DROP INDEX IF EXISTS public.idx_change_log_actor;
ALTER TABLE IF EXISTS ONLY public.vendors DROP CONSTRAINT IF EXISTS vendors_vendor_index_key;
ALTER TABLE IF EXISTS ONLY public.vendors DROP CONSTRAINT IF EXISTS vendors_pkey;
ALTER TABLE IF EXISTS ONLY public.vendor_types DROP CONSTRAINT IF EXISTS vendor_types_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_user_index_key;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.user_types DROP CONSTRAINT IF EXISTS user_types_pkey;
ALTER TABLE IF EXISTS ONLY public.user_types DROP CONSTRAINT IF EXISTS user_types_code_key;
ALTER TABLE IF EXISTS ONLY public.terminal_parent_skus DROP CONSTRAINT IF EXISTS terminal_parent_skus_pkey;
ALTER TABLE IF EXISTS ONLY public.terminal_parent_skus DROP CONSTRAINT IF EXISTS terminal_parent_skus_parent_sku_number_key;
ALTER TABLE IF EXISTS ONLY public.skus DROP CONSTRAINT IF EXISTS skus_sku_number_key;
ALTER TABLE IF EXISTS ONLY public.skus DROP CONSTRAINT IF EXISTS skus_pkey;
ALTER TABLE IF EXISTS ONLY public.sku_vendor_assocs DROP CONSTRAINT IF EXISTS sku_vendor_assocs_pkey;
ALTER TABLE IF EXISTS ONLY public.sku_types DROP CONSTRAINT IF EXISTS sku_types_pkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE IF EXISTS ONLY public.password_resets DROP CONSTRAINT IF EXISTS password_resets_pkey;
ALTER TABLE IF EXISTS ONLY public.locations DROP CONSTRAINT IF EXISTS locations_pkey;
ALTER TABLE IF EXISTS ONLY public.locations DROP CONSTRAINT IF EXISTS locations_location_index_key;
ALTER TABLE IF EXISTS ONLY public.counters DROP CONSTRAINT IF EXISTS counters_pkey;
ALTER TABLE IF EXISTS ONLY public.contacts DROP CONSTRAINT IF EXISTS contacts_pkey;
ALTER TABLE IF EXISTS ONLY public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_index_key;
ALTER TABLE IF EXISTS ONLY public.change_log DROP CONSTRAINT IF EXISTS change_log_pkey;
ALTER TABLE IF EXISTS public.vendors ALTER COLUMN vendor_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.vendor_types ALTER COLUMN vendor_type_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.users ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.user_types ALTER COLUMN user_type_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.terminal_parent_skus ALTER COLUMN parent_sku_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.skus ALTER COLUMN sku_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.sku_vendor_assocs ALTER COLUMN sku_vendor_assoc_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.sku_types ALTER COLUMN sku_type_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.locations ALTER COLUMN location_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.contacts ALTER COLUMN contact_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.change_log ALTER COLUMN change_log_id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.vendors_vendor_id_seq;
DROP TABLE IF EXISTS public.vendors;
DROP SEQUENCE IF EXISTS public.vendor_types_vendor_type_id_seq;
DROP TABLE IF EXISTS public.vendor_types;
DROP SEQUENCE IF EXISTS public.users_user_id_seq;
DROP TABLE IF EXISTS public.users;
DROP SEQUENCE IF EXISTS public.user_types_user_type_id_seq;
DROP TABLE IF EXISTS public.user_types;
DROP SEQUENCE IF EXISTS public.terminal_parent_skus_parent_sku_id_seq;
DROP TABLE IF EXISTS public.terminal_parent_skus;
DROP SEQUENCE IF EXISTS public.skus_sku_id_seq;
DROP TABLE IF EXISTS public.skus;
DROP SEQUENCE IF EXISTS public.sku_vendor_assocs_sku_vendor_assoc_id_seq;
DROP TABLE IF EXISTS public.sku_vendor_assocs;
DROP SEQUENCE IF EXISTS public.sku_types_sku_type_id_seq;
DROP TABLE IF EXISTS public.sku_types;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.password_resets;
DROP SEQUENCE IF EXISTS public.locations_location_id_seq;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.counters;
DROP SEQUENCE IF EXISTS public.contacts_contact_id_seq;
DROP TABLE IF EXISTS public.contacts;
DROP SEQUENCE IF EXISTS public.change_log_change_log_id_seq;
DROP TABLE IF EXISTS public.change_log;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_log (
    change_log_id bigint NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    actor_user_id integer,
    actor_user_index text,
    action text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: change_log_change_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.change_log_change_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: change_log_change_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.change_log_change_log_id_seq OWNED BY public.change_log.change_log_id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    contact_id integer NOT NULL,
    contact_index text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    mobile text,
    vendor_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: contacts_contact_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_contact_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_contact_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_contact_id_seq OWNED BY public.contacts.contact_id;


--
-- Name: counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counters (
    name text NOT NULL,
    value bigint NOT NULL
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    location_id integer NOT NULL,
    location_index text NOT NULL,
    vendor_id integer NOT NULL,
    location_name text NOT NULL,
    address_line_1 text,
    address_line_2 text,
    pincode text,
    city text,
    state text,
    principal_contact_id integer NOT NULL,
    secondary_contact_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: locations_location_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.locations_location_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: locations_location_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.locations_location_id_seq OWNED BY public.locations.location_id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sku_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_types (
    sku_type_id integer NOT NULL,
    name text NOT NULL,
    serial_eligible boolean DEFAULT false NOT NULL,
    is_seed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: sku_types_sku_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sku_types_sku_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sku_types_sku_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sku_types_sku_type_id_seq OWNED BY public.sku_types.sku_type_id;


--
-- Name: sku_vendor_assocs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_vendor_assocs (
    sku_vendor_assoc_id integer NOT NULL,
    sku_id integer NOT NULL,
    vendor_id integer NOT NULL,
    vendor_sku_number text NOT NULL,
    vendor_sku_specification_pdf text,
    vendor_sku_price_moq integer,
    vendor_sku_price_unit numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: sku_vendor_assocs_sku_vendor_assoc_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sku_vendor_assocs_sku_vendor_assoc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sku_vendor_assocs_sku_vendor_assoc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sku_vendor_assocs_sku_vendor_assoc_id_seq OWNED BY public.sku_vendor_assocs.sku_vendor_assoc_id;


--
-- Name: skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skus (
    sku_id integer NOT NULL,
    sku_number text NOT NULL,
    sku_name text NOT NULL,
    description text,
    stm text NOT NULL,
    sku_type_id integer NOT NULL,
    specifications_pdf text,
    approx_price_moq integer,
    approx_price_unit numeric,
    status text DEFAULT 'Active'::text NOT NULL,
    parent_sku_id integer,
    adaptor_sku_ids jsonb,
    usb_cable_sku_ids jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: skus_sku_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skus_sku_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skus_sku_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skus_sku_id_seq OWNED BY public.skus.sku_id;


--
-- Name: terminal_parent_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_parent_skus (
    parent_sku_id integer NOT NULL,
    parent_sku_number text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: terminal_parent_skus_parent_sku_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_parent_skus_parent_sku_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_parent_skus_parent_sku_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_parent_skus_parent_sku_id_seq OWNED BY public.terminal_parent_skus.parent_sku_id;


--
-- Name: user_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_types (
    user_type_id integer NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    is_seed boolean DEFAULT false NOT NULL,
    is_immutable boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: user_types_user_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_types_user_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_types_user_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_types_user_type_id_seq OWNED BY public.user_types.user_type_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    user_index text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    user_type_id integer NOT NULL,
    email text NOT NULL,
    password_hash text,
    mobile text,
    vendor_id integer,
    employee_id text,
    address_line_1 text,
    address_line_2 text,
    pincode text,
    city text,
    state text,
    status text DEFAULT 'Active'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: vendor_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_types (
    vendor_type_id integer NOT NULL,
    name text NOT NULL,
    is_seed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: vendor_types_vendor_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_types_vendor_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_types_vendor_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_types_vendor_type_id_seq OWNED BY public.vendor_types.vendor_type_id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    vendor_id integer NOT NULL,
    vendor_index text NOT NULL,
    company_name text NOT NULL,
    vendor_type_id integer NOT NULL,
    gst_number text,
    reg_line_1 text,
    reg_line_2 text,
    reg_pincode text,
    reg_city text,
    reg_state text,
    op_line_1 text,
    op_line_2 text,
    op_pincode text,
    op_city text,
    op_state text,
    status text DEFAULT 'Active'::text NOT NULL,
    is_seed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_vendor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_vendor_id_seq OWNED BY public.vendors.vendor_id;


--
-- Name: change_log change_log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log ALTER COLUMN change_log_id SET DEFAULT nextval('public.change_log_change_log_id_seq'::regclass);


--
-- Name: contacts contact_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN contact_id SET DEFAULT nextval('public.contacts_contact_id_seq'::regclass);


--
-- Name: locations location_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations ALTER COLUMN location_id SET DEFAULT nextval('public.locations_location_id_seq'::regclass);


--
-- Name: sku_types sku_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_types ALTER COLUMN sku_type_id SET DEFAULT nextval('public.sku_types_sku_type_id_seq'::regclass);


--
-- Name: sku_vendor_assocs sku_vendor_assoc_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_vendor_assocs ALTER COLUMN sku_vendor_assoc_id SET DEFAULT nextval('public.sku_vendor_assocs_sku_vendor_assoc_id_seq'::regclass);


--
-- Name: skus sku_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus ALTER COLUMN sku_id SET DEFAULT nextval('public.skus_sku_id_seq'::regclass);


--
-- Name: terminal_parent_skus parent_sku_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_parent_skus ALTER COLUMN parent_sku_id SET DEFAULT nextval('public.terminal_parent_skus_parent_sku_id_seq'::regclass);


--
-- Name: user_types user_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_types ALTER COLUMN user_type_id SET DEFAULT nextval('public.user_types_user_type_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: vendor_types vendor_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_types ALTER COLUMN vendor_type_id SET DEFAULT nextval('public.vendor_types_vendor_type_id_seq'::regclass);


--
-- Name: vendors vendor_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN vendor_id SET DEFAULT nextval('public.vendors_vendor_id_seq'::regclass);


--
-- Data for Name: change_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.change_log (change_log_id, object_type, object_id, actor_user_id, actor_user_index, action, occurred_at) FROM stdin;
1	User	UIN-10002	1	UIN-10001	Create	2026-05-17 17:01:08.954712+05:30
2	UserType	17	1	UIN-10001	Create	2026-05-17 17:48:32.706948+05:30
3	User	UIN-10003	1	UIN-10001	Create	2026-05-17 17:51:06.730682+05:30
4	User	UIN-10002	1	UIN-10001	SoftDelete	2026-05-17 17:51:44.695178+05:30
5	User	UIN-10004	1	UIN-10001	Create	2026-05-17 18:00:28.457912+05:30
6	Contact	NIN-10001	4	UIN-10004	Create	2026-05-17 19:07:45.482182+05:30
7	Contact	NIN-10001	4	UIN-10004	Update	2026-05-17 19:07:49.764271+05:30
8	Location	LIN-10000001	4	UIN-10004	Create	2026-05-17 19:08:33.851613+05:30
9	TerminalParentSKU	PNN-10001	4	UIN-10004	Create	2026-05-17 22:39:58.446064+05:30
10	SKU	INN-10001	4	UIN-10004	Create	2026-05-17 22:53:44.850794+05:30
11	SKU	INN-10002	4	UIN-10004	Create	2026-05-17 22:54:16.926711+05:30
12	SKU	INN-10003	4	UIN-10004	Create	2026-05-17 22:58:35.525907+05:30
13	SKU	INN-10003	4	UIN-10004	Update	2026-05-17 23:01:32.978266+05:30
\.


--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contacts (contact_id, contact_index, first_name, last_name, email, mobile, vendor_id, created_at, updated_at, deleted_at) FROM stdin;
1	NIN-10001	Ayush	Suryavanshi	ayush.suryavanshi@innoviti.com	\N	1	2026-05-17 19:07:45.480416+05:30	2026-05-17 19:07:49.754747+05:30	\N
\.


--
-- Data for Name: counters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.counters (name, value) FROM stdin;
vendor	10001
user	10004
contact	10001
location	10000001
parent_sku	10001
sku	10003
\.


--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.locations (location_id, location_index, vendor_id, location_name, address_line_1, address_line_2, pincode, city, state, principal_contact_id, secondary_contact_id, created_at, updated_at, deleted_at) FROM stdin;
1	LIN-10000001	1	Bangalore	Domlur	\N	560001	Bangalore	Karnataka	1	\N	2026-05-17 19:08:33.8498+05:30	2026-05-17 19:08:33.8498+05:30	\N
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (token, user_id, expires_at, consumed_at, invalidated_at, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (token, user_id, expires_at, created_at) FROM stdin;
6a36a54efd1a04cc0f6811181994e8369e21d771f7fcb1dccf93664a7397bae4	1	2026-05-18 05:01:01.181+05:30	2026-05-17 17:01:01.183539+05:30
6be9b9749a27a4baac2e96743fdd7926ed1f1b58579b43c1ffd043f8938733a7	1	2026-05-18 05:51:06.534+05:30	2026-05-17 17:51:06.540081+05:30
f27baf4db580b08d0debf44e2bf36614e549fe6a0667e6ea7c20255fdfa4c23a	1	2026-05-18 05:57:15.679+05:30	2026-05-17 17:57:15.681992+05:30
6dedb1f6290c5e211fdbd8fef089d203a1dfc08e8b2d86f787882dfeed1a46bf	1	2026-05-18 06:52:14.482+05:30	2026-05-17 18:52:14.483544+05:30
f8a788764520e3c48b89264e1edaa82f49f14679c316283a289c70301aa90a6f	1	2026-05-18 10:41:39.217+05:30	2026-05-17 22:41:39.225136+05:30
209b08fa4af67bae4f19181fe4d578aa1e6fd0f7964a36b983b60fe5291d0fbf	1	2026-05-18 11:02:20.396+05:30	2026-05-17 23:02:20.398117+05:30
\.


--
-- Data for Name: sku_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sku_types (sku_type_id, name, serial_eligible, is_seed, created_at, updated_at, deleted_at) FROM stdin;
1	Payment Terminal	t	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
2	Base Station	t	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
3	SIM Card	t	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
4	Assembly Line Assets	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
5	Adaptors	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
6	USB cables	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
7	Paper rolls	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
8	Tools	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
9	Consumables	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
10	Spare Parts	f	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
\.


--
-- Data for Name: sku_vendor_assocs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sku_vendor_assocs (sku_vendor_assoc_id, sku_id, vendor_id, vendor_sku_number, vendor_sku_specification_pdf, vendor_sku_price_moq, vendor_sku_price_unit, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: skus; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.skus (sku_id, sku_number, sku_name, description, stm, sku_type_id, specifications_pdf, approx_price_moq, approx_price_unit, status, parent_sku_id, adaptor_sku_ids, usb_cable_sku_ids, created_at, updated_at, deleted_at) FROM stdin;
1	INN-10001	5W adapter	\N	None	5	\N	100	100.02	Active	\N	\N	\N	2026-05-17 22:53:44.849047+05:30	2026-05-17 22:53:44.849047+05:30	\N
2	INN-10002	Type C cable	\N	None	6	\N	100	99.99	Active	\N	\N	\N	2026-05-17 22:54:16.92545+05:30	2026-05-17 22:54:16.92545+05:30	\N
3	INN-10003	A910 Base	\N	Serial	1	\N	100	1000.01	Active	1	[1]	[2]	2026-05-17 22:58:35.52414+05:30	2026-05-17 23:01:32.9663+05:30	\N
\.


--
-- Data for Name: terminal_parent_skus; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.terminal_parent_skus (parent_sku_id, parent_sku_number, name, description, created_at, updated_at) FROM stdin;
1	PNN-10001	MOV	mov parent SKU\n	2026-05-17 22:39:58.445035+05:30	2026-05-17 22:39:58.445035+05:30
\.


--
-- Data for Name: user_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_types (user_type_id, code, label, is_seed, is_immutable, created_at, updated_at, deleted_at) FROM stdin;
1	SA	Super Admin	t	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
2	ADMIN	Admin	t	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
3	ASO	Area Service Officer	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
4	STU	Store User	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
5	ALU	Assembly Line User	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
6	RLU	Repair Line User	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
7	FNU	Finance User	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
8	LOU	Logistics User	t	f	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
17	LBW	Leg before wicket	f	f	2026-05-17 17:48:32.693513+05:30	2026-05-17 17:48:32.693513+05:30	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (user_id, user_index, first_name, last_name, user_type_id, email, password_hash, mobile, vendor_id, employee_id, address_line_1, address_line_2, pincode, city, state, status, last_login_at, created_at, updated_at, deleted_at) FROM stdin;
3	UIN-10003	Test	ByEsA	3	sa.created@innoviti.com	$2a$10$BJIaJ7wy5wWmoQM4ySnYFOUUWctpD7iyvA80f2qcREn93isARI8Ji	\N	1	IC/0099	\N	\N	\N	\N	\N	Active	\N	2026-05-17 17:51:06.729202+05:30	2026-05-17 17:51:06.729202+05:30	\N
2	UIN-10002	Asha	Khan	2	asha@innoviti.com	$2a$10$76oJ3CxUQLOzdYDZJhblQOoM7Q5FDtht43chBrqX4xB5Fs4R3r5yW	\N	1	IC/0042	\N	\N	\N	\N	\N	Inactive	\N	2026-05-17 17:01:08.952817+05:30	2026-05-17 17:01:08.952817+05:30	2026-05-17 17:51:44.681656+05:30
4	UIN-10004	admin	Test	2	artechie0806@gmail.com	$2a$10$O0vhL0u1.BpexHi7jTshMOVE70RXhevGd/um4OsVbw0Yba2ucNili	9004068593	1	IC/9999	\N	\N	560001	Bangalore	Karnataka	Active	2026-05-17 18:02:10.722243+05:30	2026-05-17 18:00:28.455868+05:30	2026-05-17 18:00:28.455868+05:30	\N
1	UIN-10001	Super	Admin	1	superadmin@innoviti.local	$2a$10$cSdDdxq9RfVVkcVza0gR4ufNfe69FIWghA.5Zc6ELWIdLeUlYqV/6	\N	1	\N	\N	\N	\N	\N	\N	Active	2026-05-17 23:02:20.399925+05:30	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
\.


--
-- Data for Name: vendor_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendor_types (vendor_type_id, name, is_seed, created_at, updated_at, deleted_at) FROM stdin;
1	Logistics Vendors	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
2	SKU Vendors	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
3	Service Vendors	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
4	Merchant	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
5	Innoviti	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
\.


--
-- Data for Name: vendors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vendors (vendor_id, vendor_index, company_name, vendor_type_id, gst_number, reg_line_1, reg_line_2, reg_pincode, reg_city, reg_state, op_line_1, op_line_2, op_pincode, op_city, op_state, status, is_seed, created_at, updated_at, deleted_at) FROM stdin;
1	VEN-10001	Innoviti	5	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Active	t	2026-05-17 17:00:43.982673+05:30	2026-05-17 17:00:43.982673+05:30	\N
\.


--
-- Name: change_log_change_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.change_log_change_log_id_seq', 13, true);


--
-- Name: contacts_contact_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.contacts_contact_id_seq', 1, true);


--
-- Name: locations_location_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.locations_location_id_seq', 1, true);


--
-- Name: sku_types_sku_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sku_types_sku_type_id_seq', 10, true);


--
-- Name: sku_vendor_assocs_sku_vendor_assoc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sku_vendor_assocs_sku_vendor_assoc_id_seq', 1, false);


--
-- Name: skus_sku_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.skus_sku_id_seq', 3, true);


--
-- Name: terminal_parent_skus_parent_sku_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.terminal_parent_skus_parent_sku_id_seq', 1, true);


--
-- Name: user_types_user_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_types_user_type_id_seq', 65, true);


--
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_user_id_seq', 4, true);


--
-- Name: vendor_types_vendor_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendor_types_vendor_type_id_seq', 5, true);


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vendors_vendor_id_seq', 1, true);


--
-- Name: change_log change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log
    ADD CONSTRAINT change_log_pkey PRIMARY KEY (change_log_id);


--
-- Name: contacts contacts_contact_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_contact_index_key UNIQUE (contact_index);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (contact_id);


--
-- Name: counters counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counters
    ADD CONSTRAINT counters_pkey PRIMARY KEY (name);


--
-- Name: locations locations_location_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_location_index_key UNIQUE (location_index);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (location_id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (token);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token);


--
-- Name: sku_types sku_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_types
    ADD CONSTRAINT sku_types_pkey PRIMARY KEY (sku_type_id);


--
-- Name: sku_vendor_assocs sku_vendor_assocs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_vendor_assocs
    ADD CONSTRAINT sku_vendor_assocs_pkey PRIMARY KEY (sku_vendor_assoc_id);


--
-- Name: skus skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_pkey PRIMARY KEY (sku_id);


--
-- Name: skus skus_sku_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_sku_number_key UNIQUE (sku_number);


--
-- Name: terminal_parent_skus terminal_parent_skus_parent_sku_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_parent_skus
    ADD CONSTRAINT terminal_parent_skus_parent_sku_number_key UNIQUE (parent_sku_number);


--
-- Name: terminal_parent_skus terminal_parent_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_parent_skus
    ADD CONSTRAINT terminal_parent_skus_pkey PRIMARY KEY (parent_sku_id);


--
-- Name: user_types user_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_types
    ADD CONSTRAINT user_types_code_key UNIQUE (code);


--
-- Name: user_types user_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_types
    ADD CONSTRAINT user_types_pkey PRIMARY KEY (user_type_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_user_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_index_key UNIQUE (user_index);


--
-- Name: vendor_types vendor_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_types
    ADD CONSTRAINT vendor_types_pkey PRIMARY KEY (vendor_type_id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (vendor_id);


--
-- Name: vendors vendors_vendor_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_vendor_index_key UNIQUE (vendor_index);


--
-- Name: idx_change_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_log_actor ON public.change_log USING btree (actor_user_id);


--
-- Name: idx_change_log_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_log_object ON public.change_log USING btree (object_type, object_id);


--
-- Name: idx_change_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_log_time ON public.change_log USING btree (occurred_at);


--
-- Name: idx_sku_types_name_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sku_types_name_ci ON public.sku_types USING btree (lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: idx_sva_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sva_unique ON public.sku_vendor_assocs USING btree (sku_id, vendor_id, vendor_sku_number) WHERE (deleted_at IS NULL);


--
-- Name: idx_tps_name_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tps_name_ci ON public.terminal_parent_skus USING btree (lower(name));


--
-- Name: idx_users_email_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_email_ci ON public.users USING btree (lower(email)) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_employee_id ON public.users USING btree (employee_id) WHERE ((employee_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_vendor_types_name_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendor_types_name_ci ON public.vendor_types USING btree (lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendors_gst_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendors_gst_unique ON public.vendors USING btree (gst_number) WHERE ((gst_number IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: change_log change_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log
    ADD CONSTRAINT change_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id);


--
-- Name: contacts contacts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: locations locations_principal_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_principal_contact_id_fkey FOREIGN KEY (principal_contact_id) REFERENCES public.contacts(contact_id);


--
-- Name: locations locations_secondary_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_secondary_contact_id_fkey FOREIGN KEY (secondary_contact_id) REFERENCES public.contacts(contact_id);


--
-- Name: locations locations_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: sku_vendor_assocs sku_vendor_assocs_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_vendor_assocs
    ADD CONSTRAINT sku_vendor_assocs_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES public.skus(sku_id);


--
-- Name: sku_vendor_assocs sku_vendor_assocs_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_vendor_assocs
    ADD CONSTRAINT sku_vendor_assocs_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: skus skus_parent_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_parent_sku_id_fkey FOREIGN KEY (parent_sku_id) REFERENCES public.terminal_parent_skus(parent_sku_id);


--
-- Name: skus skus_sku_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_sku_type_id_fkey FOREIGN KEY (sku_type_id) REFERENCES public.sku_types(sku_type_id);


--
-- Name: users users_user_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_type_id_fkey FOREIGN KEY (user_type_id) REFERENCES public.user_types(user_type_id);


--
-- Name: users users_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendors vendors_vendor_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_vendor_type_id_fkey FOREIGN KEY (vendor_type_id) REFERENCES public.vendor_types(vendor_type_id);


--
-- PostgreSQL database dump complete
--

\unrestrict 6QdN8oX22A9ci2VNT67VaDkiVxHISwCwGQtOrm0qDfjmCpU9ZoMxT9ACdOQwnWn

