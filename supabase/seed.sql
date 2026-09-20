-- Portfolio Follow-up Board — realistic demo data
-- Niche: an independent mutual fund distributor / adviser in India.
-- Money is stored in paise (rupees x 100). Safe to re-run: clears the table first.

truncate table public.followups;

insert into public.followups (client_name, advisor, reason, value_at_risk_paise, outcome) values
  ('Meera Krishnan',   'Priya Nair',   'Review overdue',                        125000000, 'waiting'),
  ('Arjun Bhatt',      'Rohit Malhotra','Stopped SIP',                           48000000, 'waiting'),
  ('Sunita Agarwal',   'Anjali Desai', 'Capital gain decision before year end', 280000000, 'waiting'),
  ('Rajesh Iyer',      'Vikram Sethi', 'Review overdue',                         92000000, 'called'),
  ('Farhan Qureshi',   'Priya Nair',   'Capital gain decision before year end', 450000000, 'waiting'),
  ('Lakshmi Venkatesan','Anjali Desai','Stopped SIP',                            36000000, 'met'),
  ('Deepak Chawla',    'Rohit Malhotra','Review overdue',                        71000000, 'waiting'),
  ('Ayesha Siddiqui',  'Vikram Sethi', 'Stopped SIP',                            54000000, 'waiting'),
  ('Naveen Reddy',     'Priya Nair',   'Capital gain decision before year end', 197500000, 'called'),
  ('Kavita Menon',     'Anjali Desai', 'Review overdue',                        151000000, 'waiting'),
  ('Sanjay Gupta',     'Rohit Malhotra','Stopped SIP',                           22500000, 'lost'),
  ('Pooja Sharma',     'Vikram Sethi', 'Capital gain decision before year end', 334000000, 'waiting'),
  ('Imran Khan',       'Priya Nair',   'Review overdue',                         68000000, 'met'),
  ('Ritu Jain',        'Anjali Desai', 'Stopped SIP',                            41500000, 'waiting'),
  ('Alok Nanda',       'Rohit Malhotra','Capital gain decision before year end', 520000000, 'waiting'),
  ('Shreya Banerjee',  'Vikram Sethi', 'Review overdue',                         89000000, 'called'),
  ('Harish Pillai',    'Priya Nair',   'Stopped SIP',                            30500000, 'waiting'),
  ('Divya Rao',        'Anjali Desai', 'Review overdue',                        116000000, 'waiting');
