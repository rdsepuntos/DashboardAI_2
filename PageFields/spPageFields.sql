USE [Agtech_Usermgmt]
GO
/****** Object:  StoredProcedure [dbo].[spPageFields_New]    Script Date: 9/24/2026 11:22:28 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/*
 Created By    : Andrea Fabricante
 Company       : Agtech
 Project       : Farm Minder
 Procedure Name: 
 
*/

ALTER PROCEDURE [dbo].[spPageFields_New]
	@ParentPageID int,
	@UCPageID int,
	@StoreID int ,
	@ApplicationName varchar(256)  ,
	@RefKey varchar(50) ='' ,
	@IsVis bit =  0  ,
	@Debug  bit  = 0 ,
	@RegisterTypeID	int	 = 0,
	@PagesFieldHdrID int  = 0 ,
	@ProcessTypeID INT  =   0 

AS
	set @IsVis = 0
	DECLARE @MemberID INT
	if @RegisterTypeID = '-46' 
	begin
		set @ParentPageID =820
		set @UCPageID = 5333
		set @RegisterTypeID = 0
	end
	SELECT @MemberID = MEMBERID FROM AGTECH_WHSMONITOR.DBO.STORE
	WHERE STOREID = @STOREID

	--if @RegisterTypeID = '46' 
	--begin
	--	set @ParentPageID =1009
	--	set @UCPageID = 1009
	--	set @RegisterTypeID = 46
	--end
	if @RegisterTypeID = '60' 
	begin
		set @ParentPageID =1066
		set @UCPageID = 1066
		set @RegisterTypeID = 60
	end
	--	if @RegisterTypeID = '56' 
	--begin
	--	set @ParentPageID =1054
	--	set @UCPageID = 5234
	--	set @RegisterTypeID = 56
	--	set @PagesFieldHdrID = 67
	--end
	
	--	if @RegisterTypeID = '33' 
	--begin
	--	set @PagesFieldHdrID = 11
	--end
	
	


	--else 	if @RegisterTypeID = '50' 
	--begin
	--set @ParentPageID =1013
	--set @UCPageID = 1013
	--set @RegisterTypeID = 50
	--end



	if isnull(@ParentPageID,0) >0 and  isnull(@PagesFieldHdrID,0 ) = 0 
	begin 
		if  isnull(@RegisterTypeID,0)  > 0
			Select @PagesFieldHdrID  = PagesFieldHdrID from  PagesFieldsHdr where pageid =  @ParentPageID and isnull (IsPageFieldAccess,0) = 1  and isnull(RegTypeID,0) = @RegisterTypeID
		else 			
			Select @PagesFieldHdrID  = PagesFieldHdrID from  PagesFieldsHdr where pageid =  @ParentPageID and isnull (IsPageFieldAccess,0) = 1  
	end 			
	
	if isnull(@ParentPageID,0) = 0  and  isnull(@PagesFieldHdrID,0) > 0  
	begin
		Select @ParentPageID  = PageID   ,@RegisterTypeID = isnull(RegTypeID,0)
		from  PagesFieldsHdr where PagesFieldHdrID =  @PagesFieldHdrID  
	end 
	
	Declare @Parentmemberid int , @BlockID int	 , @T int 	, @OmniParentID int ,   @OT int , @BlockParentID int  

	Select  @Parentmemberid  =  isnull(parentmemberid,0) , 	@BlockID  = isnull(blockid,0) ,@OmniParentID  = isnull (OmniParentID ,0) 
	from members  	where memberid = @MemberID
	Set  @T = @MemberID
 
 

 	if isnull( @Parentmemberid,0)  > 0 and  isnull(@BlockID,0 )  > 0  -- block account 
	begin 
		Set @BlockParentID  =  @Parentmemberid
		Select   	 @OmniParentID  = isnull (OmniParentID ,0) ,@Parentmemberid =  ISNULL(ParentMemberID,0) , 	@BlockID  = isnull(blockid,0)
		from members  	where memberid = @Parentmemberid
		Set  @T = @Parentmemberid
		 
	end 
 
	if isnull( @Parentmemberid,0)  > 0 and  isnull(@BlockID,0 )  > 0  -- block account 
	begin 
		Set  @T = @Parentmemberid
		Set  @OT = @OmniParentID
		
	end 		
	else if isnull( @Parentmemberid,0)  > 0 and isnull( @OmniParentID,0) =  0 
	begin 
		Set  @T = @Parentmemberid
		Set  @OT = 0 
	end 
	else if isnull( @OmniParentID,0) > 0 
	begin 
		Set  @T = @Parentmemberid
		Set  @OT = @OmniParentID
	end 

	Declare @TMemberID int 
	Set @TMemberID = @MemberID


	--select  @TMemberID ,@T as T, @OT, @Parentmemberid as  aprent , @OmniParentID  as omni

	if exists (Select 1 from  [PagesFieldMemberAccess] where UCPageID = @UCPageID and memberid = @TMemberID )
	begin 
		Set @TMemberID = @MemberID
			 
	end 
	ELSE IF ISNULL(@BlockParentID,0) > 0  AND  exists (Select 1 from  [PagesFieldMemberAccess] where UCPageID = @UCPageID and memberid = @BlockParentID )
	begin 
		Set @TMemberID = @BlockParentID
			 
	end 		
	else 
	begin 
		if isnull(@T,0)  > 0
		begin
			if exists (Select 1 from  [PagesFieldMemberAccess] where UCPageID = @UCPageID and memberid = @T )
			begin 
				Set @TMemberID = @T  
				 
			end 				
			else if @OT > 0
			begin 
				if exists (Select 1 from  [PagesFieldMemberAccess] where UCPageID = @UCPageID and memberid = @OT )
					Set @TMemberID = @OT  
			end 
			else 
			begin 
				if exists (Select 1 from  [PagesFieldMemberAccess] where UCPageID = @UCPageID and memberid = @BlockParentID )
					Set @TMemberID = @BlockParentID  
			end 
		end 	

	end 
	 

	IF ISNULL(@RegisterTypeID,0) = 0  
	BEGIN 	 
		-- Process Builder 
		IF ISNULL(@ProcessTypeID,0) > 0 
		BEGIN 
			-- Check if setting is configured for the currently logged in user 
			if exists (Select 1 from  [PagesFieldNames] A  
				LEFT outer  join (select PageFieldID ,ColVisible from   [dbo].[PagesFieldMemberAccess] B where B.MemberID =  @TMemberID and UCPageID = @UCPageID 
					AND B.PagesFieldHdrID = @PagesFieldHdrID and ( isnull (@RefKey ,'') =  '' or B.RefKey =  @RefKey)) 	B ON  A.PageFieldID =  B.PageFieldID 
				where A.[UCPageID] =  @UCPageID and ( ( @IsVis =1 and B.ColVisible =1) or @IsVis =0))
				and  @PagesFieldHdrID > 0 
			begin 

					SELECT pgname. [PageFieldID]
					  ,pgname.[UCPageID]
					  ,pgname.[PagesFieldHdrID]
					  ,[FieldControlID]
					  ,[FieldNameDesc]
					  ,[ControlType]
					  ,pgname.[ColName] as  [ColName]
					  ,case  when isnull ( B.ColCaption ,'')  =  '' then pgname.[ColCaption] else  B.ColCaption end as  ColCaption
					  ,case  when B.[ColVisible] is null then pgname.[ColVisible] else  B.[ColVisible] end as  [ColVisible]
					  ,case  when isnull ( B.[ColErrMsg] ,'')  =  '' then pgname.[ColErrMsg] else  B.[ColErrMsg] end as  [ColErrMsg] 
					  ,case  when B.[ColRequired] is null then pgname.[ColRequired] else  B.[ColRequired] end [ColRequired] 
					  ,[IsHdr]
					  ,[IsTable]   ,
					  cfg.Required  as ColRequiredOrig 
					  , pgname.ParentPanelID 
					  , B.RefKey
					  , pgname.DisplayOrder 
					  , B.ColVisible as ColVisible
					  , pgname.TableColumnID
				  FROM  [dbo].[PagesFieldNames] pgname 
						inner join  (Select PagesFieldHdrID from PagesFieldsHdr where ProcessTypeID =  @ProcessTypeID and PageID= @ParentPageID  and PageID= @ParentPageID  ) pghdr on pgname.PagesFieldHdrID =  pghdr.PagesFieldHdrID 
						Left outer  join (Select [ColErrMsg] , ColName, [ColCaption], [ColRequired], RefKey, ColVisible
							,PagesFieldHdrID, PageFieldID  from   [dbo].[PagesFieldMemberAccess] B where B.MemberID =  @TMemberID
							and UCPageID = @UCPageID and B.PagesFieldHdrID = @PagesFieldHdrID and ( isnull (@RefKey ,'') =  '' or B.RefKey =  @RefKey )
							) B    on  pgname.PagesFieldHdrID =   B.PagesFieldHdrID  and
									  pgname.ColName  =   B.ColName 
						Left outer join (Select  * from config_Register cfg where cfg.RegTypeID = @RegisterTypeID  and isnull(cfg.ColVisible,0) =1   ) 
							cfg on pgname.ColName = cfg.ColName 
				  where  pgname.[UCPageID] =  @UCPageID   and ( ( @IsVis =1 and pgname.ColVisible =1) or @IsVis =0)   
					and pgname.PagesFieldHdrID = @PagesFieldHdrID 
				  ORDER  BY pgname.DisplayOrder  ASC
				  
			END 
			ELSE 
			begin 
			  
				-- get default
					SELECT pgname. [PageFieldID]
					  ,pgname.[UCPageID]
					  ,pgname.[PagesFieldHdrID]
					  ,[FieldControlID]
					  ,[FieldNameDesc]
					  ,[ControlType]
					  ,pgname.[ColName] as  [ColName]
					  ,pgname.[ColCaption] ColCaption
					  ,pgname.[ColVisible] as  ColVisisible
					  ,pgname.[ColErrMsg] [ColErrMsg] 
					  ,pgname.[ColRequired] [ColRequired] 
					  ,[IsHdr]
					  ,[IsTable]   
					  ,CAST(0 AS BIT) AS ColRequiredOrig 
					  , pgname.ParentPanelID 
					  , pgname.RefKey
					  , pgname.DisplayOrder 
					  , pgname.ColVisible as ColVisisible
					  , pgname.TableColumnID
				  FROM  [dbo].[PagesFieldNames] pgname 
						inner join  (Select PagesFieldHdrID from PagesFieldsHdr where ProcessTypeID =  @ProcessTypeID and PageID= @ParentPageID  ) pghdr on pgname.PagesFieldHdrID =  pghdr.PagesFieldHdrID 
				  where  pgname.[UCPageID] =  @UCPageID   and ( ( @IsVis =1 and pgname.ColVisible =1) or @IsVis =0)   
					and pgname.PagesFieldHdrID = @PagesFieldHdrID 
				  ORDER  BY pgname.DisplayOrder  ASC
		
			END 
	
		END 
		ELSE 
		BEGIN 

			SELECT A. [PageFieldID]
				  ,A.[UCPageID]
				  ,A.[PagesFieldHdrID]
				  ,[FieldControlID]
				  ,[FieldNameDesc]
				  ,[ControlType]
				  ,A.[ColName]
				  ,case  when isnull ( B.ColCaption ,'')  =  '' then A.[ColCaption] else  B.ColCaption end as  ColCaption
				  ,case  when B.[ColVisible] is null then A.[ColVisible] else  B.[ColVisible] end as  ColVisisible
				  ,case  when isnull ( B.[ColErrMsg] ,'')  =  '' then A.[ColErrMsg] else  B.[ColErrMsg] end as  [ColErrMsg] 
				  ,case  when B.[ColRequired] is null then A.[ColRequired] else  B.[ColRequired] end as  [ColRequired] 
				  ,[IsHdr]
				  ,[IsTable]
				  , A.ColRequired  as  ColRequiredOrig
				  ,A.ParentPanelID 
				  , B.RefKey 
				  ,@TMemberID
				    , A.TableColumnID
			  FROM [dbo].[PagesFieldNames] A 
					Left outer  join (select * from   [dbo].[PagesFieldMemberAccess] B where B.MemberID =  @TMemberID
						and UCPageID = @UCPageID and B.PagesFieldHdrID = @PagesFieldHdrID 
						and ( isnull (@RefKey ,'') =  '' or B.RefKey =  @RefKey )
				
						) B    on  A.PageFieldID =  B.PageFieldID 
			  where A.[UCPageID] =  @UCPageID 
  			   and ( ( @IsVis =1 and B.ColVisible =1) or @IsVis =0) 
			  ORDER  BY A.DisplayOrder  ASC
			  		SELECT 1
		END               
	END 
	ELSE 
	BEGIN 

			if exists (Select 1 from  [PagesFieldNames] A  
				LEFT outer  join (select PageFieldID ,ColVisible from   [dbo].[PagesFieldMemberAccess] B where B.MemberID =  @TMemberID and UCPageID = @UCPageID 
					AND B.PagesFieldHdrID = @PagesFieldHdrID and ( isnull (@RefKey ,'') =  '' or B.RefKey =  @RefKey)) 	B ON  A.PageFieldID =  B.PageFieldID 
				where A.[UCPageID] =  @UCPageID and ( ( @IsVis =1 and B.ColVisible =1) or @IsVis =0))
				and  @PagesFieldHdrID > 0 
			begin 
					print '===='
		print @PagesFieldHdrID
		print @RefKey
		print @UCPageID
		print @PagesFieldHdrID
		print @tmemberid

				SELECT pgname. [PageFieldID]
				  ,pgname.[UCPageID]
				  ,pgname.[PagesFieldHdrID]
				  ,[FieldControlID]
				  ,[FieldNameDesc]
				  ,[ControlType]
				  ,pgname.[ColName] as  [ColName]
				  ,case  when isnull ( B.ColCaption ,'')  =  '' then pgname.[ColCaption] else  B.ColCaption end as  ColCaption
				  ,case  when B.[ColVisible] is null then pgname.[ColVisible] else  B.[ColVisible] end as  ColVisisible
				  ,case  when isnull ( B.[ColErrMsg] ,'')  =  '' then pgname.[ColErrMsg] else  B.[ColErrMsg] end as  [ColErrMsg] 
				  ,case  when B.[ColRequired] is null then pgname.[ColRequired] else  B.[ColRequired] end [ColRequired] 
				  ,[IsHdr]
				  ,[IsTable]   ,
				  cfg.Required  as ColRequiredOrig 
				  , pgname.ParentPanelID 
				  , B.RefKey
				  , pgname.DisplayOrder 
				  , B.ColVisible as ColVisisible2
				   , pgname.TableColumnID
			  FROM  [dbo].[PagesFieldNames] pgname 
					inner join  (Select PagesFieldHdrID from PagesFieldsHdr where regtypeid =  @RegisterTypeID and PageID= @ParentPageID  ) pghdr on pgname.PagesFieldHdrID =  pghdr.PagesFieldHdrID 
					Left outer  join (Select [ColErrMsg] , ColName, [ColCaption], [ColRequired], RefKey, ColVisible
						,PagesFieldHdrID, PageFieldID  from   [dbo].[PagesFieldMemberAccess] B where B.MemberID =  @TMemberID
						and UCPageID = @UCPageID and B.PagesFieldHdrID = @PagesFieldHdrID and ( isnull (@RefKey ,'') =  '' or B.RefKey =  @RefKey )
						) B    on  pgname.PagesFieldHdrID =   B.PagesFieldHdrID  and
								  pgname.ColName  =   B.ColName 
					Left outer join (Select  * from config_Register cfg where cfg.RegTypeID = @RegisterTypeID  and isnull(cfg.ColVisible,0) =1   ) 
						cfg on pgname.ColName = cfg.ColName 
			  where ( pgname.[UCPageID] =  @UCPageID   and ( ( @IsVis =1 and pgname.ColVisible =1) or @IsVis =0)   
				and pgname.PagesFieldHdrID = @PagesFieldHdrID 

				)

								
				or FieldControlID = 'wcCreatedBy' or FieldControlID = 'wcDraft' or pgname .PageFieldID = 2300
			  ORDER  BY pgname.DisplayOrder  asc

			end
			else 
			begin 

				-- old implementation based  on  config_register 
					SELECT [CfgRegID] as  [PageFieldID]
					  ,@UCPageID  [UCPageID]
					  ,0 as [PagesFieldHdrID]
					  ,'wc' + A.[ColName] [FieldControlID]
					  ,ltrim(rtrim([ColCaption]))  [FieldNameDesc]
					  ,'' [ControlType]
					  ,A.[ColName]
					  ,A.[ColCaption] ColCaption
					  ,A.[ColVisible] ColVisisible
					  ,A.[ColErrMsg]  [ColErrMsg] 
					  ,A.Required [ColRequired] 
					  ,cast(0 as bit) [IsHdr]
					  ,cast(0 as bit) [IsTable]
					  ,A.Required  as  ColRequiredOrig
					  , ParentPanelID 
					  ,'' as RefKey 
				  FROM [dbo].[config_Register] A   where RegTypeID = @RegisterTypeID 
				   
			END
	 


	END 

	   


