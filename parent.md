-- MULTI SITE
select B.StoreID from Agtech_Usermgmt.dbo.Members a
join Agtech_WHSMonitor.dbo.Store b on b.memberid = a.memberid
JOIN Agtech_WHSMonitor.DBO.Store C ON C.MemberID = A.ParentMemberID
where a.parentmemberid > 0 and c.StoreID = 6094

-- OMNISITE
select B.StoreID, A.OmniParentID from Agtech_Usermgmt.dbo.Members a
join Agtech_WHSMonitor.dbo.Store b on b.memberid = a.memberid
JOIN Agtech_WHSMonitor.DBO.Store C ON C.MemberID = A.OmniParentID
where a.OmniParentID > 0 and c.StoreID = 5667
