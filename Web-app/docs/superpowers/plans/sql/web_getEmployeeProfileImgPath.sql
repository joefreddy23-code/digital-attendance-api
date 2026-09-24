DROP PROCEDURE IF EXISTS web_getEmployeeProfileImgPath;

DELIMITER $$

CREATE PROCEDURE web_getEmployeeProfileImgPath(
    IN p_empId INT,
    IN p_email VARCHAR(255)
)
BEGIN
    SELECT profileImgPath
    FROM employee
    WHERE (p_empId IS NOT NULL AND empId = p_empId)
       OR (
            p_empId IS NULL
            AND p_email IS NOT NULL
            AND email = p_email
          )
    LIMIT 1;
END$$

DELIMITER ;
