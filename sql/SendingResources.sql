-- users
select top 10 StoreUserID, FirstName, LastName, EmailAddress from StoreUsers where ISNULL(deleted,0) = 0 and active = 1 and StoreUserID in (1)
--division
select top 10 a.StoreUserID, FirstName, LastName, EmailAddress from StoreUsers a 
join StoreUserDivisionDepartment b on b.StoreUserID = a .StoreUserID
where b.DivisionID in (
 1
) and ISNULL(deleted,0) = 0 and active = 1 
--department
select top 10 a.StoreUserID, FirstName, LastName, EmailAddress from StoreUsers a 
join StoreUserDivisionDepartment b on b.StoreUserID = a .StoreUserID
where b.DepartmentID in (
 1 
) and ISNULL(deleted,0) = 0 and active = 1 
--department
select top 10 a.StoreUserID, FirstName, LastName, EmailAddress from StoreUsers a 
join StoreUserStoreUserType b on b.StoreUserID = a .StoreUserID
where b.StoreUserTypeID in (
 1
) and ISNULL(deleted,0) = 0 and active = 1 